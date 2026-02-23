/**
 * Payment routes – Phase 3 enterprise-hardened.
 *
 * Middleware stack per route:
 *  authenticate   → verify JWT (HS256 only, clockTolerance, req.user)
 *  idempotency    → require Idempotency-Key header, replay cached responses
 *  rateLimit      → per-route limit (initiate 5/min, confirm 5/min,
 *                   cancel 3/min, status 30/min) keyed by userId or IP
 *  handler        → Zod-validated controller
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { Request } from 'express';
import { authenticate } from '../middlewares/jwt.middleware';
import { idempotency } from '../middlewares/idempotency.middleware';
import {
  initiatePayment,
  confirmPayment,
  cancelPayment,
  getPaymentStatus,
} from '../controllers/payment.controller';

const router = Router();

// ─── Rate-limit key generator (userId if authenticated, else IP) ──────────────

const makeKeyGenerator =
  (route: string) =>
  (req: Request): string => {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = forwarded
      ? (typeof forwarded === 'string' ? forwarded : forwarded[0]).split(',').pop()?.trim() ?? 'unknown'
      : req.socket.remoteAddress ?? 'unknown';
    const userId = req.user?.id ?? ip;
    return `rl:${route}:${userId}`;
  };

const env = (key: string, fallback: number): number =>
  parseInt(process.env[key] ?? String(fallback), 10);

const rateLimitResponse = {
  success: false,
  error: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests. Please retry after the window resets.',
  },
};

// POST /payments/initiate – create a new PENDING payment (5 req/min/user)
router.post(
  '/initiate',
  authenticate,
  idempotency,
  rateLimit({
    windowMs:        env('RATE_LIMIT_INITIATE_WINDOW_MS', 60_000),
    max:             env('RATE_LIMIT_INITIATE_MAX', 5),
    keyGenerator:    makeKeyGenerator('initiate'),
    standardHeaders: true,
    legacyHeaders:   false,
    message:         rateLimitResponse,
  }),
  initiatePayment,
);

// POST /payments/confirm – transition PENDING → CONFIRMED (5 req/min/user)
router.post(
  '/confirm',
  authenticate,
  idempotency,
  rateLimit({
    windowMs:        env('RATE_LIMIT_CONFIRM_WINDOW_MS', 60_000),
    max:             env('RATE_LIMIT_CONFIRM_MAX', 5),
    keyGenerator:    makeKeyGenerator('confirm'),
    standardHeaders: true,
    legacyHeaders:   false,
    message:         rateLimitResponse,
  }),
  confirmPayment,
);

// POST /payments/cancel – transition PENDING/CONFIRMED → CANCELLED (3 req/min/user)
router.post(
  '/cancel',
  authenticate,
  idempotency,
  rateLimit({
    windowMs:        env('RATE_LIMIT_CANCEL_WINDOW_MS', 60_000),
    max:             env('RATE_LIMIT_CANCEL_MAX', 3),
    keyGenerator:    makeKeyGenerator('cancel'),
    standardHeaders: true,
    legacyHeaders:   false,
    message:         rateLimitResponse,
  }),
  cancelPayment,
);

// GET /payments/:id/status – retrieve current payment status (30 req/min/user)
router.get(
  '/:id/status',
  authenticate,
  rateLimit({
    windowMs:        env('RATE_LIMIT_STATUS_WINDOW_MS', 60_000),
    max:             env('RATE_LIMIT_STATUS_MAX', 30),
    keyGenerator:    makeKeyGenerator('status'),
    standardHeaders: true,
    legacyHeaders:   false,
    message:         rateLimitResponse,
  }),
  getPaymentStatus,
);

export default router;
