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
 * The in-memory store is suitable for single-instance deployments and tests.
 * Swap it with a Redis-backed store for distributed deployments.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ─── Store ────────────────────────────────────────────────────────────────────

interface CachedResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  expiresAt: number;
}

class IdempotencyStore {
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

// Singleton store – shared across all requests in this process.
const store = new IdempotencyStore();

/** TTL in milliseconds read from ENV; defaults to 10 minutes. */
const TTL_MS = parseInt(process.env.IDEMPOTENCY_TTL_MS ?? String(10 * 60 * 1000), 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Idempotency middleware.
 *
 * Must be applied *after* the JWT middleware so that `req.user.id` is available.
 */
export const idempotency = (req: Request, res: Response, next: NextFunction): void => {
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

  const userId = req.user?.id ?? 'anonymous';
  const cacheKey = `${userId}:${idempotencyKey}`;

  // Check whether we already have a cached response for this key.
  const cached = store.get(cacheKey);
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

    store.set(cacheKey, {
      statusCode: res.statusCode,
      headers,
      body,
      expiresAt: Date.now() + TTL_MS,
    });

    return originalJson(body);
  };

  next();
};
