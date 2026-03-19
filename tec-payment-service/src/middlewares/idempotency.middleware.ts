import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ─── Store interface ──────────────────────────────────────

export interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  expiresAt: number;
}

export interface IIdempotencyStore {
  get(key: string): Promise<CachedResponse | undefined> | CachedResponse | undefined;
  set(key: string, entry: CachedResponse): Promise<void> | void;
}

// ─── In-memory store ──────────────────────────────────────

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

// ─── Redis store ──────────────────────────────────────────

interface IRedisClient {
  set(key: string, value: string, expiryMode: string, time: number, setMode: string): Promise<string | null>;
  get(key: string): Promise<string | null>;
  on(event: string, handler: (err: Error) => void): void;
}

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
      if (Date.now() > entry.expiresAt) return undefined;
      return entry;
    } catch {
      return undefined;
    }
  }

  async set(key: string, entry: CachedResponse): Promise<void> {
    const ttlMs = Math.max(entry.expiresAt - Date.now(), 0);
    if (ttlMs === 0) return;
    const result = await this.client.set(key, JSON.stringify(entry), 'PX', ttlMs, 'NX');
    if (result === null) {
      logger.debug('Idempotency Redis NX write skipped – key already exists', { key });
    }
  }
}

// ─── Store factory & singleton ────────────────────────────

export const createIdempotencyStore = (): IIdempotencyStore => {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Redis = require('ioredis');
      const client: IRedisClient = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,          // ✅ غير من 1 لـ 3
        enableOfflineQueue: true,          // ✅ غير من false لـ true
        retryStrategy: (times: number) => Math.min(times * 100, 3000), // ✅ أضف
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

let _store: IIdempotencyStore = new InMemoryIdempotencyStore();

export const setIdempotencyStore = (store: IIdempotencyStore): void => {
  _store = store;
};

export const initIdempotencyStore = (): void => {
  _store = createIdempotencyStore();
};

const getTtlMs = (): number =>
  parseInt(process.env.IDEMPOTENCY_TTL_MS ?? String(10 * 60 * 1000), 10);

// ─── Middleware ───────────────────────────────────────────

export const idempotency = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
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

  const cached = await _store.get(cacheKey);
  if (cached) {
    logger.info('Idempotency cache hit – replaying response', {
      cacheKey,
      statusCode: cached.statusCode,
      requestId: req.headers['x-request-id'],
    });

    Object.entries(cached.headers).forEach(([name, value]) => {
      res.setHeader(name, value);
    });

    res.status(cached.statusCode).json(cached.body);
    return;
  }

  const originalJson = res.json.bind(res) as (body: unknown) => Response;

  res.json = (body: unknown): Response => {
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
