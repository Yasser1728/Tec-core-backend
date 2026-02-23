/**
 * Per-route rate-limiting middleware for the payment service.
 *
 * Uses `express-rate-limit` with a custom `keyGenerator` so windows are
 * scoped per authenticated user (`req.user.id`) with a fallback to the
 * client IP for unauthenticated callers.
 *
 * All limits are ENV-configurable:
 *  RATE_LIMIT_INITIATE_MAX  / RATE_LIMIT_INITIATE_WINDOW_MS  (default 5 / 60 000)
 *  RATE_LIMIT_CONFIRM_MAX   / RATE_LIMIT_CONFIRM_WINDOW_MS   (default 5 / 60 000)
 *  RATE_LIMIT_CANCEL_MAX    / RATE_LIMIT_CANCEL_WINDOW_MS    (default 3 / 60 000)
 *  RATE_LIMIT_STATUS_MAX    / RATE_LIMIT_STATUS_WINDOW_MS    (default 30 / 60 000)
 */
import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const env = (key: string, fallback: number): number =>
  parseInt(process.env[key] ?? String(fallback), 10);

/** Extract the best available client IP. */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const ips = (typeof forwarded === 'string' ? forwarded : forwarded[0])
      .split(',')
      .map((s) => s.trim());
    return ips[ips.length - 1];
  }
  return req.socket.remoteAddress ?? 'unknown';
}

/** Key generator: prefer the verified userId, fall back to client IP. */
const makeKeyGenerator =
  (route: string) =>
  (req: Request): string => {
    const userId = req.user?.id ?? getClientIp(req);
    return `rl:${route}:${userId}`;
  };

// ─── Per-route limiters ───────────────────────────────────────────────────────

/** Limiter for POST /payments/initiate – 5 req/min/user by default. */
export const initiateRateLimiter = rateLimit({
  windowMs:      env('RATE_LIMIT_INITIATE_WINDOW_MS', 60_000),
  max:           env('RATE_LIMIT_INITIATE_MAX', 5),
  keyGenerator:  makeKeyGenerator('initiate'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry after the window resets.',
    },
  },
});

/** Limiter for POST /payments/confirm – 5 req/min/user by default. */
export const confirmRateLimiter = rateLimit({
  windowMs:      env('RATE_LIMIT_CONFIRM_WINDOW_MS', 60_000),
  max:           env('RATE_LIMIT_CONFIRM_MAX', 5),
  keyGenerator:  makeKeyGenerator('confirm'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry after the window resets.',
    },
  },
});

/** Limiter for POST /payments/cancel – 3 req/min/user by default. */
export const cancelRateLimiter = rateLimit({
  windowMs:      env('RATE_LIMIT_CANCEL_WINDOW_MS', 60_000),
  max:           env('RATE_LIMIT_CANCEL_MAX', 3),
  keyGenerator:  makeKeyGenerator('cancel'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry after the window resets.',
    },
  },
});

/** Limiter for GET /payments/:id/status – 30 req/min/user by default. */
export const statusRateLimiter = rateLimit({
  windowMs:      env('RATE_LIMIT_STATUS_WINDOW_MS', 60_000),
  max:           env('RATE_LIMIT_STATUS_MAX', 30),
  keyGenerator:  makeKeyGenerator('status'),
  standardHeaders: true,
  legacyHeaders:   false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests. Please retry after the window resets.',
    },
  },
});

