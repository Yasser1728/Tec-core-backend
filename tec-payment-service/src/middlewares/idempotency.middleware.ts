import { Request, Response, NextFunction } from 'express';
import { logWarn, logInfo } from '../utils/logger';

interface CachedResponse {
  statusCode: number;
  body: unknown;
  expiresAt: number;
}

const idempotencyStore = new Map<string, CachedResponse>();

const getIdempotencyTtl = (): number =>
  parseInt(process.env.IDEMPOTENCY_TTL_MS ?? '600000', 10); // default 10 minutes

// Periodically remove expired entries to prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of idempotencyStore) {
    if (now >= entry.expiresAt) {
      idempotencyStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Idempotency middleware — enforces Idempotency-Key header on mutating requests.
 *
 * - Key must be present and at least 10 characters.
 * - Cache key format: userId:idempotencyKey
 * - TTL default 10 minutes (configurable via IDEMPOTENCY_TTL_MS).
 * - Returns the cached response (statusCode + body) for duplicate requests.
 */
export const idempotencyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;

  if (!idempotencyKey) {
    logWarn('Idempotency-Key header missing', { method: req.method, path: req.path });
    res.status(400).json({
      success: false,
      error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' },
    });
    return;
  }

  if (idempotencyKey.length < 10) {
    res.status(400).json({
      success: false,
      error: {
        code: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be at least 10 characters',
      },
    });
    return;
  }

  const userId = req.userId ?? req.user?.id ?? 'anonymous';
  const storeKey = `${userId}:${idempotencyKey}`;

  const cached = idempotencyStore.get(storeKey);
  if (cached && Date.now() < cached.expiresAt) {
    logInfo('Returning cached idempotent response', { storeKey, statusCode: cached.statusCode });
    res.status(cached.statusCode).json(cached.body);
    return;
  }

  // Intercept res.json to cache the response before sending
  const originalJson = res.json.bind(res) as (body?: unknown) => Response;
  res.json = function (body?: unknown): Response {
    const ttl = getIdempotencyTtl();
    idempotencyStore.set(storeKey, {
      statusCode: res.statusCode,
      body,
      expiresAt: Date.now() + ttl,
    });
    return originalJson(body);
  };

  next();
};

/** Expose the store for testing */
export const _getIdempotencyStore = (): Map<string, CachedResponse> => idempotencyStore;
