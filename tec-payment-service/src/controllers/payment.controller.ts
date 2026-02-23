/**
 * Payment controller – Phase 3 enterprise-hardened implementation.
 *
 * Endpoints:
 *  POST   /payments/initiate  – Create a new PENDING payment.
 *  POST   /payments/confirm   – Atomically transition PENDING → CONFIRMED.
 *  POST   /payments/cancel    – Atomically transition PENDING/CONFIRMED → CANCELLED.
 *  GET    /payments/:id/status – Retrieve the current status of a payment.
 *
 * Design decisions:
 *  - All monetary amounts are handled as `Prisma.Decimal` to avoid JS float
 *    precision issues.  No `Number()` or `parseFloat()` is used on amounts.
 *  - State transitions are validated against a transition guard Map; invalid
 *    transitions produce a 409 Conflict and an AuditLog entry.
 *  - CONFIRM cannot modify the amount; any attempt is ignored.
 *  - All mutations run inside a single Prisma `$transaction` call.
 *  - Validation is performed with Zod; invalid input returns 422.
 */
import { Request, Response } from 'express';
import { z } from 'zod';
import { Decimal } from '../../prisma/client/runtime/library';
import { prisma } from '../config/database';
import { PaymentStatus, AuditEventType } from '../../prisma/client';
import { logger } from '../utils/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum allowed payment amount (ENV-configurable). */
const MAX_LIMIT = new Decimal(process.env.PAYMENT_MAX_LIMIT ?? '1000000');

// ─── Transition guard ─────────────────────────────────────────────────────────

/**
 * Allowed source statuses for each target status.
 * Only transitions listed here are permitted; all others produce 409 + AuditLog.
 */
const TRANSITION_GUARD = new Map<PaymentStatus, PaymentStatus[]>([
  [PaymentStatus.CONFIRMED,  [PaymentStatus.PENDING]],
  [PaymentStatus.CANCELLED,  [PaymentStatus.PENDING, PaymentStatus.CONFIRMED]],
  [PaymentStatus.FAILED,     [PaymentStatus.PENDING, PaymentStatus.CONFIRMED]],
]);

// ─── Validation schemas ───────────────────────────────────────────────────────

/** Zod refinement: converts the raw value to a Decimal and validates range. */
const decimalAmount = z
  .string()
  .or(z.number())
  .transform((v) => new Decimal(String(v)))
  .refine((d) => d.greaterThan(0), { message: 'amount must be greater than 0' })
  .refine((d) => d.lessThanOrEqualTo(MAX_LIMIT), {
    message: 'amount exceeds the maximum allowed limit',
  });

const initiateSchema = z.object({
  amount:         decimalAmount,
  currency:       z
    .string()
    .min(2)
    .max(10)
    .regex(/^[A-Z]+$/, 'currency must be UPPERCASE letters only'),
  idempotencyKey: z.string().min(1).max(255),
});

const confirmSchema = z.object({
  paymentId: z.string().uuid('paymentId must be a valid UUID'),
});

const cancelSchema = z.object({
  paymentId: z.string().uuid('paymentId must be a valid UUID'),
});

const statusParamSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

/** Return a Zod validation failure response (422 Unprocessable Entity). */
function zodError(res: Response, issues: z.ZodIssue[]): void {
  res.status(422).json({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: 'Invalid input data',
      details: issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
  });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/**
 * POST /payments/initiate
 *
 * Creates a new payment in PENDING status.  The `idempotencyKey` is stored
 * on the record; the pair `(userId, idempotencyKey)` is unique so retries are
 * safe.  The idempotency *response* cache is handled upstream by the
 * idempotency middleware.
 */
export const initiatePayment = async (req: Request, res: Response): Promise<void> => {
  const parsed = initiateSchema.safeParse(req.body);
  if (!parsed.success) {
    zodError(res, parsed.error.issues);
    return;
  }

  const { amount, currency, idempotencyKey } = parsed.data;
  const userId = req.user!.id;
  const requestId = req.headers['x-request-id'] as string | undefined;
  const ipAddress = getClientIp(req);

  try {
    const payment = await prisma.$transaction(async (tx) => {
      const p = await tx.payment.create({
        data: {
          userId,
          amount,
          currency,
          status: PaymentStatus.PENDING,
          idempotencyKey,
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          paymentId: p.id,
          eventType: AuditEventType.PAYMENT_INITIATED,
          metadata: { amount: amount.toString(), currency, requestId },
          ipAddress,
        },
      });

      return p;
    });

    logger.info('Payment initiated', { paymentId: payment.id, userId, requestId });

    res.status(201).json({
      success: true,
      data: {
        payment: {
          id:             payment.id,
          userId:         payment.userId,
          amount:         payment.amount.toString(),
          currency:       payment.currency,
          status:         payment.status,
          idempotencyKey: payment.idempotencyKey,
          createdAt:      payment.createdAt,
          updatedAt:      payment.updatedAt,
        },
      },
    });
  } catch (error: unknown) {
    const e = error as { code?: string };
    if (e.code === 'P2002') {
      // Unique constraint on (userId, idempotencyKey) – the idempotency
      // middleware should have caught a replay, but handle the DB edge case.
      res.status(409).json({
        success: false,
        error: {
          code: 'DUPLICATE_IDEMPOTENCY_KEY',
          message: 'A payment with this idempotency key already exists',
        },
      });
      return;
    }

    logger.error('initiatePayment error', { message: (error as Error).message, requestId });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
};

/**
 * POST /payments/confirm
 *
 * Atomically transitions a PENDING payment to CONFIRMED.
 * Cannot modify the amount – only the status is updated.
 * Returns 409 if the payment is not in a valid source state.
 */
export const confirmPayment = async (req: Request, res: Response): Promise<void> => {
  const parsed = confirmSchema.safeParse(req.body);
  if (!parsed.success) {
    zodError(res, parsed.error.issues);
    return;
  }

  const { paymentId } = parsed.data;
  const userId = req.user!.id;
  const requestId = req.headers['x-request-id'] as string | undefined;
  const ipAddress = getClientIp(req);

  try {
    const updatedPayment = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });

      if (!payment) {
        const err: NodeJS.ErrnoException = new Error('Payment not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      const allowed = TRANSITION_GUARD.get(PaymentStatus.CONFIRMED) ?? [];
      if (!allowed.includes(payment.status)) {
        // Write audit log for invalid transition, then reject.
        await tx.auditLog.create({
          data: {
            userId,
            paymentId: payment.id,
            eventType: AuditEventType.INVALID_TRANSITION,
            metadata: {
              from:       payment.status,
              to:         PaymentStatus.CONFIRMED,
              requestId,
            },
            ipAddress,
          },
        });

        const err: NodeJS.ErrnoException = new Error(
          `Cannot confirm payment with status ${payment.status}`,
        );
        err.code = 'INVALID_TRANSITION';
        throw err;
      }

      // CONFIRM must not modify the amount.
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data:  { status: PaymentStatus.CONFIRMED },
      });

      await tx.auditLog.create({
        data: {
          userId,
          paymentId: updated.id,
          eventType: AuditEventType.PAYMENT_CONFIRMED,
          metadata: { from: payment.status, requestId },
          ipAddress,
        },
      });

      return updated;
    });

    logger.info('Payment confirmed', { paymentId, userId, requestId });

    res.json({
      success: true,
      data: {
        payment: {
          id:        updatedPayment.id,
          userId:    updatedPayment.userId,
          amount:    updatedPayment.amount.toString(),
          currency:  updatedPayment.currency,
          status:    updatedPayment.status,
          createdAt: updatedPayment.createdAt,
          updatedAt: updatedPayment.updatedAt,
        },
      },
    });
  } catch (error: unknown) {
    const e = error as NodeJS.ErrnoException;

    if (e.code === 'NOT_FOUND') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (e.code === 'INVALID_TRANSITION') {
      res.status(409).json({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: e.message },
      });
      return;
    }

    logger.error('confirmPayment error', { message: (error as Error).message, requestId });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
};

/**
 * POST /payments/cancel
 *
 * Atomically transitions PENDING or CONFIRMED → CANCELLED.
 * Returns 409 if the current status does not permit cancellation.
 */
export const cancelPayment = async (req: Request, res: Response): Promise<void> => {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) {
    zodError(res, parsed.error.issues);
    return;
  }

  const { paymentId } = parsed.data;
  const userId = req.user!.id;
  const requestId = req.headers['x-request-id'] as string | undefined;
  const ipAddress = getClientIp(req);

  try {
    const updatedPayment = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });

      if (!payment) {
        const err: NodeJS.ErrnoException = new Error('Payment not found');
        err.code = 'NOT_FOUND';
        throw err;
      }

      const allowed = TRANSITION_GUARD.get(PaymentStatus.CANCELLED) ?? [];
      if (!allowed.includes(payment.status)) {
        await tx.auditLog.create({
          data: {
            userId,
            paymentId: payment.id,
            eventType: AuditEventType.INVALID_TRANSITION,
            metadata: {
              from:       payment.status,
              to:         PaymentStatus.CANCELLED,
              requestId,
            },
            ipAddress,
          },
        });

        const err: NodeJS.ErrnoException = new Error(
          `Cannot cancel payment with status ${payment.status}`,
        );
        err.code = 'INVALID_TRANSITION';
        throw err;
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data:  { status: PaymentStatus.CANCELLED },
      });

      await tx.auditLog.create({
        data: {
          userId,
          paymentId: updated.id,
          eventType: AuditEventType.PAYMENT_CANCELLED,
          metadata: { from: payment.status, requestId },
          ipAddress,
        },
      });

      return updated;
    });

    logger.info('Payment cancelled', { paymentId, userId, requestId });

    res.json({
      success: true,
      data: {
        payment: {
          id:        updatedPayment.id,
          userId:    updatedPayment.userId,
          amount:    updatedPayment.amount.toString(),
          currency:  updatedPayment.currency,
          status:    updatedPayment.status,
          createdAt: updatedPayment.createdAt,
          updatedAt: updatedPayment.updatedAt,
        },
      },
    });
  } catch (error: unknown) {
    const e = error as NodeJS.ErrnoException;

    if (e.code === 'NOT_FOUND') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (e.code === 'INVALID_TRANSITION') {
      res.status(409).json({
        success: false,
        error: { code: 'INVALID_TRANSITION', message: e.message },
      });
      return;
    }

    logger.error('cancelPayment error', { message: (error as Error).message, requestId });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
};

/**
 * GET /payments/:id/status
 *
 * Returns the current status and summary of a payment.
 * Only the authenticated user who owns the payment may query it.
 */
export const getPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  const parsed = statusParamSchema.safeParse(req.params);
  if (!parsed.success) {
    zodError(res, parsed.error.issues);
    return;
  }

  const { id } = parsed.data;
  const userId = req.user!.id;
  const requestId = req.headers['x-request-id'] as string | undefined;

  try {
    const payment = await prisma.payment.findUnique({ where: { id } });

    if (!payment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    // Ownership check – only the owner may view their payment.
    if (payment.userId !== userId) {
      res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Access denied' },
      });
      return;
    }

    res.json({
      success: true,
      data: {
        payment: {
          id:             payment.id,
          userId:         payment.userId,
          amount:         payment.amount.toString(),
          currency:       payment.currency,
          status:         payment.status,
          idempotencyKey: payment.idempotencyKey,
          createdAt:      payment.createdAt,
          updatedAt:      payment.updatedAt,
        },
      },
    });
  } catch (error: unknown) {
    logger.error('getPaymentStatus error', { message: (error as Error).message, requestId });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
};

