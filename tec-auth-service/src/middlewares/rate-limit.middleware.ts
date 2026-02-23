import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

// ── Configuration ─────────────────────────────────────────────────────────────

// Window duration in ms (default: 1 minute)
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10);
// Maximum requests per window per IP (default: 20)
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX || '20', 10);

// ── Store abstraction — pluggable backend ─────────────────────────────────────

interface RateLimitStore {
  /** Increment the counter for `key`; returns the new count. */
  increment(key: string): Promise<number>;
}

// ── In-memory store (single-instance fallback) ────────────────────────────────

interface MemEntry {
  count: number;
  resetAt: number;
}

class InMemoryStore implements RateLimitStore {
  private readonly store = new Map<string, MemEntry>();

  constructor() {
    // Periodic cleanup to prevent unbounded memory growth.
    // Runs every 2× the window; .unref() avoids blocking process exit.
    setInterval(() => {
      const now = Date.now();
      this.store.forEach((entry, key) => {
        if (entry.resetAt < now) this.store.delete(key);
      });
    }, WINDOW_MS * 2).unref();
  }

  async increment(key: string): Promise<number> {
    const now = Date.now();
    const entry = this.store.get(key);
    if (!entry || entry.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return 1;
    }
    entry.count++;
    return entry.count;
  }
}

// ── Redis store (distributed, multi-instance) ─────────────────────────────────

class RedisStore implements RateLimitStore {
  private readonly redis: Redis;
  private readonly windowSec: number;

  // Lua script: atomically increment and set expiry only on first hit.
  // Running as a script prevents the race condition between INCR and EXPIRE.
  private static readonly INCR_SCRIPT = `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], ARGV[1])
    end
    return count
  `;

  constructor(redis: Redis) {
    this.redis = redis;
    // Convert ms → seconds for Redis EXPIRE
    this.windowSec = Math.ceil(WINDOW_MS / 1000);
  }

  async increment(key: string): Promise<number> {
    const redisKey = `rl:${key}`;
    // eval executes the script atomically — no race between INCR and EXPIRE
    const count = await this.redis.eval(
      RedisStore.INCR_SCRIPT,
      1,
      redisKey,
      String(this.windowSec),
    ) as number;
    return count;
  }
}

// ── Store selection ───────────────────────────────────────────────────────────

function createStore(): RateLimitStore {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redis = new Redis(redisUrl, {
      // Fail fast so the service can start even when Redis is unreachable
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    redis.on('error', (err: Error) => {
      // Log but do not crash — requests will fail open (no rate-limiting) rather
      // than taking the service down. Operators should monitor this.
      console.error('[rate-limit] Redis error — falling back to pass-through:', err.message);
    });
    return new RedisStore(redis);
  }
  return new InMemoryStore();
}

const store = createStore();

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Rate limiter for /auth endpoints.
 *
 * Uses Redis when REDIS_URL is set (multi-instance safe), otherwise falls back
 * to an in-memory store suitable for single-instance deployments.
 */
export const rateLimitMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const key = req.ip ?? 'unknown';
    const count = await store.increment(key);

    if (count > MAX_REQUESTS) {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests, please try again later',
        },
      });
      return;
    }

    next();
  } catch (err) {
    // Log unexpected store errors so operators can investigate; allow the
    // request through rather than blocking legitimate traffic on store failure.
    console.error('[rate-limit] Unexpected error — allowing request:', (err as Error).message);
    next();
  }
};

// Export store classes for testing
export { InMemoryStore, RedisStore, RateLimitStore };
