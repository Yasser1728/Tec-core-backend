/**
 * In-memory rate limiting middleware, keyed by IP + userId.
 *
 * Ready for a Redis upgrade: replace the in-memory `store` Map with Redis
 * INCR / EXPIRE commands behind the same interface to scale across multiple
 * instances.
 *
 * Default: RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW milliseconds.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/** In-memory store: key → { count, resetAt } */
const store = new Map<string, RateLimitEntry>();

/**
 * Build a rate-limiter middleware.
 *
 * @param maxRequests - Maximum requests allowed in the window (default: RATE_LIMIT_MAX or 5)
 * @param windowMs    - Window duration in milliseconds (default: RATE_LIMIT_WINDOW or 60_000)
 */
export const createRateLimiter = (
  maxRequests: number = parseInt(process.env.RATE_LIMIT_MAX ?? '5', 10),
  windowMs: number = parseInt(process.env.RATE_LIMIT_WINDOW ?? '60000', 10),
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = (() => {
      const forwarded = req.headers['x-forwarded-for'] as string | undefined;
      if (forwarded) {
        // Use the last entry in the chain – set by our trusted reverse proxy, not spoofable by the client
        const ips = forwarded.split(',').map((s) => s.trim());
        return ips[ips.length - 1];
      }
      return req.socket.remoteAddress ?? 'unknown';
    })();
    // userId may be attached by auth middleware or sent in body/query
    const userId: string =
      (req.body?.userId as string | undefined) ??
      (req.query?.userId as string | undefined) ??
      'anonymous';

    const key = `rl:${ip}:${userId}`;
    const now = Date.now();

    let entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      // First request or window expired – start a new window
      entry = { count: 1, resetAt: now + windowMs };
      store.set(key, entry);
      return next();
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn('Rate limit exceeded', { key, count: entry.count, retryAfter });
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
  };
};

/** Default rate limiter for financial operations (transfer/deposit/withdraw). */
export const financialRateLimiter = createRateLimiter();
