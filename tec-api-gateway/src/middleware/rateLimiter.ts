import rateLimit, { Options } from 'express-rate-limit';
import { Request }            from 'express';

// ── Config ────────────────────────────────────────────────
const WINDOW_MS     = parseInt(process.env.RATE_LIMIT_WINDOW_MS    || '900000'); // 15 min
const MAX_REQUESTS  = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS  || '100');
const AUTH_MAX      = parseInt(process.env.RATE_LIMIT_AUTH_MAX      || '20');    // stricter للـ auth
const PAYMENT_MAX   = parseInt(process.env.RATE_LIMIT_PAYMENT_MAX   || '30');    // stricter للـ payments

// ── Key Generator — User ID أو IP ────────────────────────
const keyGenerator = (req: Request): string => {
  // استخرج userId من الـ JWT payload لو موجود
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const token   = authHeader.replace('Bearer ', '');
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1], 'base64').toString('utf-8')
      );
      const userId = payload.sub ?? payload.id;
      if (userId) return `user:${userId}`;
    } catch { /* fallback to IP */ }
  }
  // Fallback: IP address
  const ip =
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    req.ip ||
    'unknown';
  return `ip:${ip}`;
};

// ── Shared options ────────────────────────────────────────
const baseOptions: Partial<Options> = {
  windowMs:        WINDOW_MS,
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator,
  handler: (req, res) => {
    const key = keyGenerator(req);
    res.status(429).json({
      success: false,
      error: {
        code:      'RATE_LIMIT_EXCEEDED',
        message:   'Too many requests — please retry after the window resets',
        requestId: req.headers['x-request-id'],
        retryAfter: Math.ceil(WINDOW_MS / 1000),
        key,
      },
    });
  },
};

// ── Global limiter — كل الـ routes ───────────────────────
export const rateLimiter = rateLimit({
  ...baseOptions,
  max: MAX_REQUESTS,
});

// ── Auth limiter — stricter ───────────────────────────────
export const authRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 minute
  max:      AUTH_MAX,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code:       'AUTH_RATE_LIMIT_EXCEEDED',
        message:    'Too many auth attempts — please wait 1 minute',
        requestId:  req.headers['x-request-id'],
        retryAfter: 60,
      },
    });
  },
});

// ── Payment limiter — stricter ────────────────────────────
export const paymentRateLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000, // 1 minute
  max:      PAYMENT_MAX,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code:       'PAYMENT_RATE_LIMIT_EXCEEDED',
        message:    'Too many payment requests — please wait 1 minute',
        requestId:  req.headers['x-request-id'],
        retryAfter: 60,
      },
    });
  },
});
