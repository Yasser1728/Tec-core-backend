import { Request, Response, NextFunction } from 'express';
import { logWarn } from '../utils/logger';

/**
 * Idempotency middleware — enforces Idempotency-Key uniqueness.
 *
 * How it works:
 *   1. Requires an `Idempotency-Key` header on mutating requests.
 *   2. On the first request with a given key, executes the handler and
 *      caches the status code + response body.
 *   3. On duplicate requests with the same key, returns the cached response
 *      instead of re-executing the handler (safe replay).
 *
 * Store backend:
 *   - **In-memory** (default): suitable for single-instance deployments and tests.
 *   - **Redis** (when `REDIS_URL` is set): distributed, survives restarts.
 *     Uses SET with NX + PX for atomic first-write semantics.
 *
 * TTL is controlled by `IDEMPOTENCY_TTL_MS` env var (default: 24 hours).
 */

// ─── Stored response shape ────────────────────────────────────────────────────

interface CachedResponse {
  statusCode: number;
  body: unknown;
}

// ─── Store abstraction ────────────────────────────────────────────────────────

export interface IIdempotencyStore {
  /** Return the cached response if the key has been seen, or null. */
  get(key: string): Promise<CachedResponse | null>;
  /**
   * Atomically store a response for the given key only if it has not been set.
   * Returns true if stored (first write), false if already exists.
   */
  set(key: string, value: CachedResponse, ttlMs: number): Promise<boolean>;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

interface MemEntry {
  value: CachedResponse;
  expiresAt: number;
}

export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly store = new Map<string, MemEntry>();

  async get(key: string): Promise<CachedResponse | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  // Node.js is single-threaded: the check-then-set below is safe within a
  // single process because no other code runs between the Map.has() and
  // Map.set() calls. For multi-instance deployments use the RedisIdempotencyStore.
  async set(key: string, value: CachedResponse, ttlMs: number): Promise<boolean> {
    if (this.store.has(key)) return false;
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return true;
  }
}

// ─── Redis store ──────────────────────────────────────────────────────────────

interface IRedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: string, ttl: number, flag: string): Promise<string | null>;
  on(event: string, handler: (err: Error) => void): void;
}

export class RedisIdempotencyStore implements IIdempotencyStore {
  private readonly client: IRedisClient;

  constructor(client: IRedisClient) {
    this.client = client;
  }

  async get(key: string): Promise<CachedResponse | null> {
    const raw = await this.client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedResponse;
    } catch {
      return null;
    }
  }

  async set(key: string, value: CachedResponse, ttlMs: number): Promise<boolean> {
    // SET key value PX ttlMs NX — atomic: only sets if key does not exist
    const result = await this.client.set(key, JSON.stringify(value), 'PX', ttlMs, 'NX');
    return result !== null;
  }
}

// ─── Store factory ────────────────────────────────────────────────────────────

export const createIdempotencyStore = (): IIdempotencyStore => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      const client: IRedisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        // lazyConnect defers the TCP connection until the first command.
        // If the first command fails, the middleware fails open (see below).
        lazyConnect: true,
      });
      client.on('error', (err: Error) =>
        logWarn('Redis idempotency store error', { message: err.message })
      );
      return new RedisIdempotencyStore(client);
    } catch (err) {
      logWarn('ioredis not available, falling back to in-memory idempotency store', {
        message: (err as Error).message,
      });
    }
  }
  return new InMemoryIdempotencyStore();
};

let _store: IIdempotencyStore | undefined;
const getStore = (): IIdempotencyStore => {
  if (!_store) _store = createIdempotencyStore();
  return _store;
};

/** Swap the singleton store (test helper). */
export const setIdempotencyStore = (store: IIdempotencyStore): void => {
  _store = store;
};

// ─── Middleware ───────────────────────────────────────────────────────────────

const TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS ?? String(24 * 60 * 60 * 1000), 10);

/**
 * Idempotency middleware factory.
 *
 * @param requireKey - When true (default), returns 400 if Idempotency-Key is absent.
 *                     Set to false to warn-only (useful for non-critical endpoints).
 */
export const idempotencyMiddleware = (requireKey = true) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const rawKey = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

    if (!idempotencyKey) {
      if (requireKey) {
        res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Idempotency-Key header is required for this operation.',
          },
        });
        return;
      }
      logWarn('Idempotency-Key header missing', { method: req.method, path: req.path });
      next();
      return;
    }

    const userId = req.userId ?? 'anonymous';
    const storeKey = `idem:${userId}:${idempotencyKey}`;

    try {
      // Check for a cached response
      const cached = await getStore().get(storeKey);
      if (cached) {
        res.status(cached.statusCode).json(cached.body);
        return;
      }

      // Intercept the response to cache it
      const originalJson = res.json.bind(res);
      res.json = (body: unknown): Response => {
        const cached: CachedResponse = { statusCode: res.statusCode, body };
        // Fire-and-forget: errors logged but don't affect the response
        getStore().set(storeKey, cached, TTL_MS).catch((err: Error) =>
          logWarn('Failed to cache idempotency response', { message: err.message })
        );
        return originalJson(body);
      };

      next();
    } catch (err) {
      // On store error fail open — idempotency is degraded but the request proceeds
      logWarn('Idempotency store error – allowing request', { message: (err as Error).message });
      next();
    }
  };
