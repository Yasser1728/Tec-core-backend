/**
 * Rate limiting middleware with a pluggable store backend.
 *
 * - **In-memory** (default): suitable for single-instance deployments and tests.
 * - **Redis** (when `REDIS_URL` is set): atomic, distributed, survives restarts.
 *   Uses INCR + PEXPIRE for O(1) per request with no race conditions.
 *
 * Switching to Redis requires no code changes in callers — just set REDIS_URL.
 * Default limit: RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW milliseconds.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ─── Store abstraction ────────────────────────────────────────────────────────

export interface RateLimitResult {
  /** Accumulated hit count within the current window. */
  count: number;
  /** Unix timestamp (ms) when the current window resets. */
  resetAt: number;
}

export interface IRateLimitStore {
  /**
   * Increment the hit counter for `key`.
   * Creates a new window if none exists or the previous one has expired.
   * Returns the updated count and window reset time.
   */
  increment(key: string, windowMs: number): Promise<RateLimitResult>;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

interface MemEntry {
  count: number;
  resetAt: number;
}

export class InMemoryStore implements IRateLimitStore {
  private readonly store = new Map<string, MemEntry>();

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now > entry.resetAt) {
      entry = { count: 1, resetAt: now + windowMs };
      this.store.set(key, entry);
    } else {
      entry.count += 1;
    }

    return { count: entry.count, resetAt: entry.resetAt };
  }
}

// ─── Redis store ──────────────────────────────────────────────────────────────

/**
 * Minimal interface for the Redis client methods used by RedisStore.
 * This keeps the code type-safe without requiring ioredis as a compile-time dep.
 */
interface IRedisClient {
  eval(script: string, numkeys: number, key: string, windowMs: string): Promise<[number, number]>;
  on(event: string, handler: (err: Error) => void): void;
}

/**
 * Distributed rate-limit store backed by Redis.
 *
 * Uses a Lua script so that the INCR, conditional PEXPIRE, and PTTL are
 * executed atomically in a single round-trip — no race conditions.
 */
export class RedisStore implements IRateLimitStore {
  private readonly client: IRedisClient;

  /**
   * Lua script executed atomically:
   *   1. Increment the counter.
   *   2. Set the TTL on the first increment only (preserves the window boundary).
   *   3. Return [count, remaining-TTL-in-ms].
   */
  private static readonly LUA_SCRIPT = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('PEXPIRE', KEYS[1], ARGV[1])
    end
    local pttl = redis.call('PTTL', KEYS[1])
    return {count, pttl}
  `;

  constructor(client: IRedisClient) {
    this.client = client;
  }

  async increment(key: string, windowMs: number): Promise<RateLimitResult> {
    const [count, pttl] = await this.client.eval(
      RedisStore.LUA_SCRIPT,
      1,
      key,
      String(windowMs),
    );
    const resetAt = Date.now() + Math.max(pttl, 0);
    return { count, resetAt };
  }
}

// ─── Store factory ────────────────────────────────────────────────────────────

/**
 * Build the best available store.
 * Returns a RedisStore when REDIS_URL is set and ioredis can be loaded;
 * falls back to InMemoryStore otherwise.
 */
export const createStore = (): IRateLimitStore => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      const client: IRedisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: true,
      });
      client.on('error', (err: Error) =>
        logger.warn('Redis rate-limit store error', { message: err.message })
      );
      return new RedisStore(client);
    } catch (err) {
      logger.warn('ioredis not available, falling back to in-memory rate-limit store', {
        message: (err as Error).message,
      });
    }
  }
  return new InMemoryStore();
};

// Singleton store shared across all rate-limiter instances in this process.
let _store: IRateLimitStore | undefined;
const getStore = (): IRateLimitStore => {
  if (!_store) _store = createStore();
  return _store;
};

/** Swap the singleton store (test helper). */
export const setStore = (store: IRateLimitStore): void => {
  _store = store;
};

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Build a rate-limiter middleware.
 *
 * @param maxRequests - Maximum requests allowed per window (default: RATE_LIMIT_MAX or 5)
 * @param windowMs    - Window duration in milliseconds (default: RATE_LIMIT_WINDOW or 60_000)
 */
export const createRateLimiter = (
  maxRequests: number = parseInt(process.env.RATE_LIMIT_MAX ?? '5', 10),
  windowMs: number = parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000', 10),
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = (() => {
      const forwarded = req.headers['x-forwarded-for'] as string | undefined;
      if (forwarded) {
        // Use the last entry – appended by our trusted reverse proxy.
        const ips = forwarded.split(',').map((s) => s.trim());
        return ips[ips.length - 1];
      }
      return req.socket.remoteAddress ?? 'unknown';
    })();

    // Prefer the JWT-verified identity; fall back to body/query for unauthenticated callers.
    const userId: string =
      (req.userId as string | undefined) ??
      (req.body?.userId as string | undefined) ??
      (req.query?.userId as string | undefined) ??
      'anonymous';

    const key = `rl:${ip}:${userId}`;

    try {
      const { count, resetAt } = await getStore().increment(key, windowMs);

      if (count > maxRequests) {
        const retryAfter = Math.ceil((resetAt - Date.now()) / 1000);
        logger.warn('Rate limit exceeded', { key, count, retryAfter });
        res.setHeader('Retry-After', String(retryAfter));
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Retry after ${retryAfter} second(s).`,
          },
        });
        return;
      }

      next();
    } catch (err) {
      // On store error, fail open to avoid blocking legitimate requests.
      logger.warn('Rate-limit store error – allowing request', { message: (err as Error).message });
      next();
    }
  };
};

/** Default rate limiter for financial operations (transfer/deposit/withdraw). */
export const financialRateLimiter = createRateLimiter();

