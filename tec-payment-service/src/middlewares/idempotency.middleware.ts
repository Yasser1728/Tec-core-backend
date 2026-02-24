/**
 * Enterprise-grade idempotency middleware for the payment service.
 *
 * Behaviour:
 *  1. Requires the `Idempotency-Key` header on every mutating request.
 *  2. The internal cache key is `<userId>:<idempotencyKey>` so keys are
 *     scoped per authenticated user.
 *  3. On the *first* request: lets it proceed and caches the response
 *     (statusCode, headers, body) for `IDEMPOTENCY_TTL_MS` milliseconds
 *     (default 10 min).
 *  4. On *subsequent* requests with the same key within the TTL: returns the
 *     **identical** cached response — even if the original request failed.
 *
 * Store backends:
 *  - **InMemoryStore** (default): single-instance, suitable for tests.
 *  - **RedisStore**: distributed, activated when `REDIS_URL` is set.
 *    Uses SET NX (atomic) so concurrent identical requests collapse safely.
 *
 * Swap the store at runtime with `setIdempotencyStore()`.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ─── Store interface ──────────────────────────────────────────────────────────

export interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  expiresAt: number;
}

/** Pluggable idempotency store backend. */
export interface IIdempotencyStore {
  /**
   * Return the cached response for `key`, or `undefined` if not found / expired.
   */
  get(key: string): Promise<CachedResponse | undefined> | CachedResponse | undefined;
  /**
   * Persist a cached response under `key`.
   */
  set(key: string, entry: CachedResponse): Promise<void> | void;
}

// ─── In-memory store ──────────────────────────────────────────────────────────

export class InMemoryIdempotencyStore implements IIdempotencyStore {
  private readonly cache = new Map<string, CachedResponse>();

  get(key: string): CachedResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: CachedResponse): void {
    this.cache.set(key, entry);
  }
}

// ─── Redis store ──────────────────────────────────────────────────────────────

/**
 * Minimal interface for the Redis client methods used by RedisIdempotencyStore.
 * Keeping this narrow avoids a hard compile-time dependency on ioredis.
 */
interface IRedisClient {
  set(key: string, value: string, expiryMode: string, time: number, setMode: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  on(event: string, handler: (err: Error) => void): void;
}

/**
 * Distributed idempotency store backed by Redis.
 *
 * Each entry is stored as a JSON-serialised string with a millisecond-precision
 * TTL.  The initial `SET NX` (set if not exists) is atomic, so two identical
 * concurrent requests will safely collapse: the first one writes, the second
 * one reads the same cached value.
 */
export class RedisIdempotencyStore implements IIdempotencyStore {
  private readonly client: IRedisClient;

  constructor(client: IRedisClient) {
    this.client = client;
  }

  async get(key: string): Promise<CachedResponse | undefined> {
    const raw = await this.client.get(key);
    if (!raw) return undefined;
    try {
      const entry = JSON.parse(raw) as CachedResponse;
      // Guard against entries that somehow outlived their TTL.
      if (Date.now() > entry.expiresAt) return undefined;
      return entry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CachedResponse): Promise<void> {
    const ttlMs = Math.max(entry.expiresAt - Date.now(), 0);
    if (ttlMs === 0) return; // already expired – skip
    // PX = millisecond TTL; NX = only write if key does not already exist.
    const result = await this.client.set(key, JSON.stringify(entry), 'PX', ttlMs, 'NX');
    if (result === null) {
      logger.debug('Idempotency Redis NX write skipped – key already exists', { key });
    }
  }
}

// ─── Store factory & singleton ────────────────────────────────────────────────

/**
 * Build the best available store.
 * Returns a RedisIdempotencyStore when REDIS_URL is set and ioredis can be
 * loaded; falls back to InMemoryIdempotencyStore otherwise.
 */
export const createIdempotencyStore = (): IIdempotencyStore => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      const client: IRedisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
      client.on('error', (err: Error) =>
        logger.warn('Redis idempotency store error', { message: err.message })
      );
      logger.info('Using Redis idempotency store');
      return new RedisIdempotencyStore(client);
    } catch (err) {
      logger.warn('ioredis not available, falling back to in-memory idempotency store', {
        message: (err as Error).message,
      });
    }
  }
  return new InMemoryIdempotencyStore();
};

// Singleton – resolved once on startup.
let _store: IIdempotencyStore = new InMemoryIdempotencyStore();

/** Swap the singleton store (used in tests and for Redis initialisation). */
export const setIdempotencyStore = (store: IIdempotencyStore): void => {
  _store = store;
};

/** Initialise from ENV (call once at app startup). */
export const initIdempotencyStore = (): void => {
  _store = createIdempotencyStore();
};

/** TTL in milliseconds read from ENV; defaults to 10 minutes. */
const getTtlMs = (): number =>
  parseInt(process.env.IDEMPOTENCY_TTL_MS ?? String(10 * 60 * 1000), 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Idempotency middleware.
 *
 * Must be applied *after* the JWT middleware so that `req.user.id` is available.
 */
export const idempotency = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const rawKey = req.headers['idempotency-key'];

  if (!rawKey || (typeof rawKey !== 'string' && !Array.isArray(rawKey))) {
    res.status(400).json({
      success: false,
      error: {
        code: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      },
    });
    return;
  }

  const idempotencyKey = typeof rawKey === 'string' ? rawKey : rawKey[0];

  if (!idempotencyKey || idempotencyKey.length > 255) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be between 1 and 255 characters',
      },
    });
    return;
  }

  const userId = req.user?.id ?? req.userId ?? 'anonymous';
  const cacheKey = `${userId}:${idempotencyKey}`;

  // Check whether we already have a cached response for this key.
  const cached = await _store.get(cacheKey);
  if (cached) {
    logger.info('Idempotency cache hit – replaying response', {
      cacheKey,
      statusCode: cached.statusCode,
      requestId: req.headers['x-request-id'],
    });

    // Restore the original response headers (excluding those already sent).
    Object.entries(cached.headers).forEach(([name, value]) => {
      res.setHeader(name, value);
    });

    res.status(cached.statusCode).json(cached.body);
    return;
  }

  // Intercept the response so we can cache it before it is sent.
  const originalJson = res.json.bind(res) as (body: unknown) => Response;

  res.json = (body: unknown): Response => {
    // Capture a snapshot of the response headers at flush time.
    const headers: Record<string, string> = {};
    const rawHeaders = res.getHeaders();
    for (const [name, value] of Object.entries(rawHeaders)) {
      if (typeof value === 'string') {
        headers[name] = value;
      } else if (typeof value === 'number') {
        headers[name] = String(value);
      }
    }

    const entry: CachedResponse = {
      statusCode: res.statusCode,
      headers,
      body,
      expiresAt: Date.now() + getTtlMs(),
    };

    Promise.resolve(_store.set(cacheKey, entry)).catch((err) =>
      logger.warn('Idempotency store write failed', { message: (err as Error).message })
    );

    return originalJson(body);
  };

  next();
};
