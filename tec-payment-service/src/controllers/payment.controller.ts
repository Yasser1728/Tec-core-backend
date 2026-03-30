import { Request, Response } from 'express';
import { validationResult, ValidationError } from 'express-validator';
import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
  PrismaClientRustPanicError,
} from '@prisma/client/runtime/library';
import { createAuditLog } from '../utils/audit';
import { logInfo, logWarn, logError } from '../utils/logger';
import { piApprovePayment, piCompletePayment, piCancelPayment, PiApiError } from '../services/payment.service';
import { env } from '../config/env';
// ✅ حذفنا: import { creditTecWallet } from '../services/wallet.service';

type TransactionClient = Prisma.TransactionClient;

const getMetadataObject = (metadata: unknown): Record<string, unknown> => {
  return typeof metadata === 'object' && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
};

const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created: ['approved', 'cancelled', 'failed'],
  approved: ['completed', 'cancelled', 'failed'],
};

const isTransitionAllowed = (from: string, to: string): boolean =>
  (ALLOWED_TRANSITIONS[from] ?? []).includes(to);

const getMaxAmountLimit = (): number =>
  parseFloat(process.env.MAX_AMOUNT_LIMIT ?? '1000000');

// ─── Create Payment ───────────────────────────────────────
export const createPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('CreatePayment validation failed', { errors: errors.array(), body: req.body });
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data. Please check the request parameters.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { userId, amount, currency = 'PI', payment_method, metadata } = req.body;
    const maxAmount = getMaxAmountLimit();

    if (amount > maxAmount) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `amount must not exceed ${maxAmount}`,
        },
      });
      return;
    }

    logInfo('Creating payment', { userId, amount, currency, payment_method, requestId: req.requestId });

    const payment = await prisma.payment.create({
      data: {
        user_id: userId,
        amount,
        currency,
        payment_method,
        status: 'created',
        metadata: metadata || {},
      },
    });

    logInfo('Payment created successfully', {
      paymentId: payment.id,
      status: payment.status,
      requestId: req.requestId,
    });

    void createAuditLog({
      userId,
      paymentId: payment.id,
      eventType: 'PAYMENT_INITIATED',
      metadata: { amount, currency, payment_method },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.status(201).json({ success: true, data: { payment } });
  } catch (error) {
    logError('CreatePayment error', { error: (error as Error).message });

    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_PAYMENT', message: 'A payment with this information already exists' },
        });
        return;
      }
      if (error.code === 'P2003') {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_USER', message: 'User ID does not exist in the system' },
        });
        return;
      }
    }

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to create payment' },
    });
  }
};

// ─── Approve Payment ──────────────────────────────────────
export const approvePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('ApprovePayment validation failed', { errors: errors.array(), body: req.body });
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { payment_id, pi_payment_id } = req.body;

    if (pi_payment_id && (!env.PI_API_KEY || !env.PI_APP_ID)) {
      res.status(503).json({
        success: false,
        error: { code: 'SERVICE_NOT_CONFIGURED', message: 'Pi Network credentials are not configured.' },
      });
      return;
    }

    logInfo('Approving payment', { payment_id, pi_payment_id, requestId: req.requestId });

    const payment = await prisma.payment.findUnique({ where: { id: payment_id } });

    if (!payment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (!isTransitionAllowed(payment.status, 'approved')) {
      void createAuditLog({
        userId: payment.user_id,
        paymentId: payment_id,
        eventType: 'INVALID_TRANSITION_ATTEMPT',
        metadata: { from: payment.status, to: 'approved' },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
      res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Payment cannot transition from '${payment.status}' to 'approved'`,
        },
      });
      return;
    }

    if (payment.payment_method === 'pi' && pi_payment_id) {
      if (env.PI_SANDBOX === 'true') {
        logInfo('Sandbox mode: skipping Pi API approve call', { payment_id, pi_payment_id });
      } else {
        try {
          await piApprovePayment(pi_payment_id);
        } catch (piErr) {
          if (piErr instanceof PiApiError) {
            res.status(piErr.httpStatus).json({
              success: false,
              error: { code: piErr.code, message: piErr.message },
            });
            return;
          }
          throw piErr;
        }
      }
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment_id },
      data: { status: 'approved', pi_payment_id, approved_at: new Date() },
    });

    logInfo('Payment approved successfully', { paymentId: updatedPayment.id });

    void createAuditLog({
      userId: payment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_APPROVED',
      metadata: { pi_payment_id },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({ success: true, data: { payment: updatedPayment } });
  } catch (error) {
    logError('ApprovePayment error', { error: (error as Error).message });

    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(410).json({
          success: false,
          error: { code: 'PAYMENT_MODIFIED', message: 'Payment was modified or deleted during approval' },
        });
        return;
      }
      if (error.code === 'P2002') {
        res.status(409).json({
          success: false,
          error: { code: 'DUPLICATE_PI_PAYMENT', message: 'This Pi payment ID is already associated with another payment' },
        });
        return;
      }
    }

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to approve payment' },
    });
  }
};

// ─── Complete Payment ─────────────────────────────────────
export const completePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('CompletePayment validation failed', { errors: errors.array(), body: req.body });
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { payment_id, transaction_id } = req.body;

    logInfo('Completing payment', { payment_id, transaction_id, requestId: req.requestId });

    const preFlightPayment = await prisma.payment.findUnique({
      where: { id: payment_id },
      select: { status: true, payment_method: true, pi_payment_id: true, user_id: true },
    });

    if (!preFlightPayment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (!isTransitionAllowed(preFlightPayment.status, 'completed')) {
      void createAuditLog({
        userId: preFlightPayment.user_id,
        paymentId: payment_id,
        eventType: 'INVALID_TRANSITION_ATTEMPT',
        metadata: { from: preFlightPayment.status, to: 'completed' },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
      res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Payment cannot transition from '${preFlightPayment.status}' to 'completed'`,
        },
      });
      return;
    }

    if (preFlightPayment.payment_method === 'pi' && preFlightPayment.pi_payment_id) {
      if (env.PI_SANDBOX === 'true') {
        logInfo('Sandbox mode: skipping Pi API complete call', { payment_id });
      } else {
        if (!env.PI_API_KEY || !env.PI_APP_ID) {
          res.status(503).json({
            success: false,
            error: { code: 'SERVICE_NOT_CONFIGURED', message: 'Pi Network credentials are not configured.' },
          });
          return;
        }
        try {
          await piCompletePayment(
            preFlightPayment.pi_payment_id,
            transaction_id as string | undefined,
          );
        } catch (piErr) {
          if (piErr instanceof PiApiError) {
            res.status(piErr.httpStatus).json({
              success: false,
              error: { code: piErr.code, message: piErr.message },
            });
            return;
          }
          throw piErr;
        }
      }
    }

    const updatedPayment = await prisma.$transaction(async (tx: TransactionClient) => {
      const payment = await tx.payment.findUnique({ where: { id: payment_id } });

      if (!payment) {
        const err = new Error('NOT_FOUND');
        (err as Error & { statusCode: number }).statusCode = 404;
        throw err;
      }

      if (!isTransitionAllowed(payment.status, 'completed')) {
        const err = new Error('INVALID_TRANSITION');
        (err as Error & { statusCode: number; from: string }).statusCode = 409;
        (err as Error & { statusCode: number; from: string }).from = payment.status;
        throw err;
      }

      return tx.payment.update({
        where: { id: payment_id },
        data: {
          status: 'completed',
          completed_at: new Date(),
          transaction_id: transaction_id ?? null,
          metadata: {
            ...getMetadataObject(payment.metadata),
            transaction_id,
          },
        },
      });
    });

    logInfo('Payment completed successfully', { paymentId: updatedPayment.id });

    void createAuditLog({
      userId: updatedPayment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_CONFIRMED',
      metadata: { transaction_id },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({ success: true, data: { payment: updatedPayment } });

    // ✅ Event Bus بدل Direct HTTP call
    if (updatedPayment.payment_method === 'pi') {
      void (async () => {
        try {
          const { publishEvent, createPublisher, EVENTS } = await import('../services/event-bus');
          const pub = (global as any).__redisPublisher ?? createPublisher();
          await publishEvent(pub, EVENTS.PAYMENT_COMPLETED, {
            paymentId: payment_id,
            userId: updatedPayment.user_id,
            amount: updatedPayment.amount,
            currency: updatedPayment.currency,
            piPaymentId: preFlightPayment.pi_payment_id ?? '',
            timestamp: new Date().toISOString(),
          });
          logInfo('payment.completed event emitted', { paymentId: payment_id });
        } catch (err) {
          logWarn('Failed to emit payment.completed event', {
            error: (err as Error).message,
            paymentId: payment_id,
          });
        }
      })();
    }
  } catch (error) {
    const err = error as Error & { statusCode?: number; from?: string };

    if (err.message === 'NOT_FOUND') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (err.message === 'INVALID_TRANSITION') {
      void createAuditLog({
        userId: req.userId ?? 'unknown',
        paymentId: req.body.payment_id,
        eventType: 'INVALID_TRANSITION_ATTEMPT',
        metadata: { from: err.from, to: 'completed' },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
      res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Payment cannot transition from '${err.from}' to 'completed'`,
        },
      });
      return;
    }

    logError('CompletePayment error', { error: err.message });

    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(410).json({
        success: false,
        error: { code: 'PAYMENT_MODIFIED', message: 'Payment was modified or deleted during completion' },
      });
      return;
    }

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to complete payment' },
    });
  }
};

// ─── Get Payment Status ───────────────────────────────────
export const getPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        payment_method: true,
        pi_payment_id: true,
        transaction_id: true,
        created_at: true,
        approved_at: true,
        completed_at: true,
        failed_at: true,
        cancelled_at: true,
        updated_at: true,
      },
    });

    if (!payment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    res.json({ success: true, data: { payment } });
  } catch (error) {
    logError('GetPaymentStatus error', { error: (error as Error).message });

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to get payment status' },
    });
  }
};

// ─── Cancel Payment ───────────────────────────────────────
export const cancelPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { payment_id } = req.body;

    logInfo('Cancelling payment', { payment_id, requestId: req.requestId });

    const updatedPayment = await prisma.$transaction(async (tx: TransactionClient) => {
      const payment = await tx.payment.findUnique({ where: { id: payment_id } });

      if (!payment) {
        const err = new Error('NOT_FOUND');
        (err as Error & { statusCode: number }).statusCode = 404;
        throw err;
      }

      if (!isTransitionAllowed(payment.status, 'cancelled')) {
        const err = new Error('INVALID_TRANSITION');
        (err as Error & { statusCode: number; from: string }).statusCode = 409;
        (err as Error & { statusCode: number; from: string }).from = payment.status;
        throw err;
      }

      return tx.payment.update({
        where: { id: payment_id },
        data: { status: 'cancelled', cancelled_at: new Date() },
      });
    });

    logInfo('Payment cancelled successfully', { paymentId: updatedPayment.id });

    void createAuditLog({
      userId: updatedPayment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_CANCELLED',
      metadata: {},
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({ success: true, data: { payment: updatedPayment } });
  } catch (error) {
    const err = error as Error & { statusCode?: number; from?: string };

    if (err.message === 'NOT_FOUND') {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (err.message === 'INVALID_TRANSITION') {
      res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Payment cannot transition from '${err.from}' to 'cancelled'`,
        },
      });
      return;
    }

    logError('CancelPayment error', { error: err.message });

    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(410).json({
        success: false,
        error: { code: 'PAYMENT_MODIFIED', message: 'Payment was modified or deleted during cancellation' },
      });
      return;
    }

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel payment' },
    });
  }
};

// ─── Fail Payment ─────────────────────────────────────────
export const failPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { payment_id, reason } = req.body;

    logInfo('Failing payment', { payment_id, reason, requestId: req.requestId });

    const payment = await prisma.payment.findUnique({ where: { id: payment_id } });

    if (!payment) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (!isTransitionAllowed(payment.status, 'failed')) {
      res.status(409).json({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: `Payment cannot transition from '${payment.status}' to 'failed'`,
        },
      });
      return;
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment_id },
      data: {
        status: 'failed',
        failed_at: new Date(),
        metadata: {
          ...getMetadataObject(payment.metadata),
          ...(reason ? { failure_reason: reason } : {}),
        },
      },
    });

    logInfo('Payment failed successfully', { paymentId: updatedPayment.id });

    void createAuditLog({
      userId: payment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_FAILED',
      metadata: { reason },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({ success: true, data: { payment: updatedPayment } });
  } catch (error) {
    logError('FailPayment error', { error: (error as Error).message });

    if (error instanceof PrismaClientKnownRequestError && error.code === 'P2025') {
      res.status(410).json({
        success: false,
        error: { code: 'PAYMENT_MODIFIED', message: 'Payment was modified or deleted during failure recording' },
      });
      return;
    }

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to record payment failure' },
    });
  }
};

// ─── Get Payment History ──────────────────────────────────
export const getPaymentHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    const page = parseInt((req.query.page as string) ?? '1', 10) || 1;
    const limit = parseInt((req.query.limit as string) ?? '20', 10) || 20;
    const status = req.query.status as string | undefined;
    const payment_method = req.query.payment_method as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const sort = ((req.query.sort as string) ?? 'desc') === 'asc' ? 'asc' : 'desc';

    const where: Record<string, unknown> = { user_id: userId };
    if (status) where['status'] = status;
    if (payment_method) where['payment_method'] = payment_method;
    if (from || to) {
      where['created_at'] = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { created_at: sort },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          amount: true,
          currency: true,
          payment_method: true,
          status: true,
          pi_payment_id: true,
          created_at: true,
          updated_at: true,
          approved_at: true,
          completed_at: true,
          failed_at: true,
          cancelled_at: true,
        },
      }),
      prisma.payment.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      },
    });
  } catch (error) {
    logError('GetPaymentHistory error', { error: (error as Error).message });

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to retrieve payment history' },
    });
  }
};

// ─── Resolve Incomplete Payment ───────────────────────────
export const resolveIncompletePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data.',
          details: errors.array().map((err: ValidationError) => ({
            field: 'path' in err ? err.path : 'unknown',
            message: err.msg,
            value: 'value' in err ? err.value : undefined,
          })),
        },
      });
      return;
    }

    const { pi_payment_id } = req.body;
    logInfo('Resolving incomplete payment', { pi_payment_id, requestId: req.requestId });

    const payment = await prisma.payment.findUnique({ where: { pi_payment_id } });

 if (!payment) {
  if (env.PI_API_KEY) {
    try {
      await piCancelPayment(pi_payment_id);
      logInfo('Pi payment cancelled directly on Pi Network', { pi_payment_id });
    } catch (piErr) {
      logWarn('Pi direct cancel failed', { pi_payment_id, error: (piErr as Error).message });
    }
  }
  res.json({ success: true, data: { action: 'cancelled_on_pi' } });
  return;
 }

    const TERMINAL_STATUSES = ['completed', 'cancelled', 'failed'];
    if (TERMINAL_STATUSES.includes(payment.status)) {
      res.json({ success: true, data: { action: 'already_resolved' } });
      return;
    }

    if (payment.status === 'created') {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'cancelled', cancelled_at: new Date() },
      });
      void createAuditLog({
        userId: payment.user_id,
        paymentId: payment.id,
        eventType: 'PAYMENT_CANCELLED',
        metadata: { reason: 'resolve_incomplete', pi_payment_id },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
      res.json({ success: true, data: { action: 'cancelled' } });
      return;
    }

    if (payment.status === 'approved') {
      if (payment.payment_method === 'pi' && payment.pi_payment_id) {
        if (env.PI_SANDBOX === 'true') {
          logInfo('Sandbox mode: skipping Pi API complete for resolve-incomplete', { pi_payment_id });
        } else {
          if (!env.PI_API_KEY || !env.PI_APP_ID) {
            res.status(503).json({
              success: false,
              error: { code: 'SERVICE_NOT_CONFIGURED', message: 'Pi Network credentials not configured.' },
            });
            return;
          }
          try {
            await piCompletePayment(payment.pi_payment_id, undefined);
          } catch (piErr) {
            if (piErr instanceof PiApiError) {
              await prisma.payment.update({
                where: { id: payment.id },
                data: {
                  status: 'failed',
                  failed_at: new Date(),
                  metadata: { ...getMetadataObject(payment.metadata), failure_reason: piErr.message },
                },
              });
              res.json({ success: true, data: { action: 'failed' } });
              return;
            }
            throw piErr;
          }
        }
      }

      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'completed', completed_at: new Date() },
      });
      void createAuditLog({
        userId: payment.user_id,
        paymentId: payment.id,
        eventType: 'PAYMENT_CONFIRMED',
        metadata: { reason: 'resolve_incomplete', pi_payment_id },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
      res.json({ success: true, data: { action: 'completed' } });
      return;
    }

    res.json({ success: true, data: { action: 'already_resolved' } });
  } catch (error) {
    logError('ResolveIncompletePayment error', { error: (error as Error).message });

    if (error instanceof PrismaClientInitializationError || error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database connection failed.' },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to resolve incomplete payment' },
    });
  }
};

// ─── Trigger Reconciliation ───────────────────────────────
export const triggerReconciliation = async (req: Request, res: Response): Promise<void> => {
  try {
    logInfo('Reconciliation triggered', { requestId: req.requestId });
    const { reconcileStalePayments } = await import('../services/reconciliation.service');
    const result = await reconcileStalePayments();
    res.json({ success: true, data: result });
  } catch (error) {
    logError('Reconciliation error', { error: (error as Error).message });
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Reconciliation failed' },
    });
  }
};
