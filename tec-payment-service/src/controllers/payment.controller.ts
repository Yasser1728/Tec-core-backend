import { Request, Response } from 'express';
import { validationResult, ValidationError } from 'express-validator';
import { prisma } from '../config/database';
import { 
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
  PrismaClientRustPanicError 
} from '@prisma/client/runtime/library';
import { createAuditLog } from '../utils/audit';
import { logInfo, logWarn, logError } from '../utils/logger';
import { piApprovePayment, piCompletePayment, PiApiError } from '../services/payment.service';

// Helper function to safely get metadata as an object
const getMetadataObject = (metadata: unknown): Record<string, unknown> => {
  return typeof metadata === 'object' && metadata !== null ? metadata as Record<string, unknown> : {};
};

// Helper to get client IP
const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
};

// ─── Allowed state transitions ────────────────────────────────────────────────
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  created:   ['approved', 'cancelled', 'failed'],
  approved:  ['completed', 'cancelled', 'failed'],
};

const isTransitionAllowed = (from: string, to: string): boolean =>
  (ALLOWED_TRANSITIONS[from] ?? []).includes(to);

// ─── Max amount limit ─────────────────────────────────────────────────────────
const getMaxAmountLimit = (): number =>
  parseFloat(process.env.MAX_AMOUNT_LIMIT ?? '1000000');

// Create a new payment (Stage 1: Created)
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

    logInfo('Payment created successfully', { paymentId: payment.id, status: payment.status, requestId: req.requestId });

    void createAuditLog({
      userId,
      paymentId: payment.id,
      eventType: 'PAYMENT_INITIATED',
      metadata: { amount, currency, payment_method },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.status(201).json({
      success: true,
      data: { payment },
    });
  } catch (error) {
    logError('CreatePayment error', { error: (error as Error).message });
    
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_PAYMENT',
            message: 'A payment with this information already exists',
          },
        });
        return;
      }
      if (error.code === 'P2003') {
        res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_USER',
            message: 'User ID does not exist in the system',
          },
        });
        return;
      }
    }
    
    if (error instanceof PrismaClientInitializationError || 
        error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
        },
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create payment',
      },
    });
  }
};

// Approve a payment (Stage 2: Approved)
export const approvePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('ApprovePayment validation failed', { errors: errors.array(), body: req.body });
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

    const { payment_id, pi_payment_id } = req.body;
    
    logInfo('Approving payment', { payment_id, pi_payment_id, requestId: req.requestId });

    const payment = await prisma.payment.findUnique({
      where: { id: payment_id },
    });

    if (!payment) {
      logWarn('Payment not found', { payment_id });
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Payment not found',
        },
      });
      return;
    }

    if (!isTransitionAllowed(payment.status, 'approved')) {
      const userId = payment.user_id;
      logWarn('Invalid transition attempt: approve', { payment_id, from: payment.status, to: 'approved' });
      void createAuditLog({
        userId,
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

    // ─── Pi Network: approve on Pi side before persisting ─────────────────
    if (payment.payment_method === 'pi' && pi_payment_id) {
      try {
        await piApprovePayment(pi_payment_id);
      } catch (piErr) {
        if (piErr instanceof PiApiError) {
          logWarn('Pi API approve error', { payment_id, code: piErr.code, message: piErr.message });
          res.status(piErr.httpStatus).json({
            success: false,
            error: { code: piErr.code, message: piErr.message },
          });
          return;
        }
        throw piErr;
      }
    }

    const updatedPayment = await prisma.payment.update({
      where: { id: payment_id },
      data: {
        status: 'approved',
        pi_payment_id,
        approved_at: new Date(),
      },
    });

    logInfo('Payment approved successfully', { paymentId: updatedPayment.id, status: updatedPayment.status });

    void createAuditLog({
      userId: payment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_APPROVED',
      metadata: { pi_payment_id },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({
      success: true,
      data: { payment: updatedPayment },
    });
  } catch (error) {
    logError('ApprovePayment error', { error: (error as Error).message });
    
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(410).json({
          success: false,
          error: {
            code: 'PAYMENT_MODIFIED',
            message: 'Payment was modified or deleted during approval',
          },
        });
        return;
      }
      if (error.code === 'P2002') {
        res.status(409).json({
          success: false,
          error: {
            code: 'DUPLICATE_PI_PAYMENT',
            message: 'This Pi payment ID is already associated with another payment',
          },
        });
        return;
      }
    }
    
    if (error instanceof PrismaClientInitializationError || 
        error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
        },
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to approve payment',
      },
    });
  }
};

// Complete a payment atomically (Stage 3: Completed / Confirm)
export const completePayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('CompletePayment validation failed', { errors: errors.array(), body: req.body });
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

    const { payment_id, transaction_id } = req.body;
    
    logInfo('Completing payment', { payment_id, transaction_id, requestId: req.requestId });

    // ─── Pi Network: pre-flight state check + Pi API call ─────────────────
    // Fetch payment details outside the DB transaction so that a potentially
    // long-running Pi API call does not hold an open DB transaction.
    // A secondary state check inside the subsequent $transaction guards against
    // concurrent state changes that may occur while the Pi API call is in flight.
    const preFlightPayment = await prisma.payment.findUnique({
      where: { id: payment_id },
      select: { status: true, payment_method: true, pi_payment_id: true, user_id: true },
    });

    if (!preFlightPayment) {
      logWarn('Payment not found (pre-flight)', { payment_id });
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (!isTransitionAllowed(preFlightPayment.status, 'completed')) {
      logWarn('Invalid transition attempt: complete (pre-flight)', { payment_id, from: preFlightPayment.status });
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
      try {
        await piCompletePayment(preFlightPayment.pi_payment_id, transaction_id as string | undefined);
      } catch (piErr) {
        if (piErr instanceof PiApiError) {
          logWarn('Pi API complete error', { payment_id, code: piErr.code, message: piErr.message });
          res.status(piErr.httpStatus).json({
            success: false,
            error: { code: piErr.code, message: piErr.message },
          });
          return;
        }
        throw piErr;
      }
    }
    // ─── end Pi Network pre-flight ─────────────────────────────────────────

    const updatedPayment = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: payment_id },
      });

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
          metadata: {
            ...getMetadataObject(payment.metadata),
            transaction_id,
          },
        },
      });
    });

    logInfo('Payment completed successfully', { paymentId: updatedPayment.id, status: updatedPayment.status });

    void createAuditLog({
      userId: updatedPayment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_CONFIRMED',
      metadata: { transaction_id },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({
      success: true,
      data: { payment: updatedPayment },
    });
  } catch (error) {
    const err = error as Error & { statusCode?: number; from?: string };

    if (err.message === 'NOT_FOUND') {
      logWarn('Payment not found', { body: req.body });
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (err.message === 'INVALID_TRANSITION') {
      logWarn('Invalid transition attempt: complete', { payment_id: req.body.payment_id, from: err.from });
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
    
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(410).json({
          success: false,
          error: {
            code: 'PAYMENT_MODIFIED',
            message: 'Payment was modified or deleted during completion',
          },
        });
        return;
      }
    }
    
    if (error instanceof PrismaClientInitializationError || 
        error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
        },
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to complete payment',
      },
    });
  }
};

// Get payment status
export const getPaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('GetPaymentStatus validation failed', { errors: errors.array(), params: req.params });
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

    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        amount: true,
        currency: true,
        payment_method: true,
        created_at: true,
        approved_at: true,
        completed_at: true,
        failed_at: true,
        cancelled_at: true,
        updated_at: true,
      },
    });

    if (!payment) {
      logWarn('Payment not found', { id });
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Payment not found',
        },
      });
      return;
    }

    res.json({
      success: true,
      data: { payment },
    });
  } catch (error) {
    logError('GetPaymentStatus error', { error: (error as Error).message });
    
    if (error instanceof PrismaClientInitializationError || 
        error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
        },
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to get payment status',
      },
    });
  }
};

// Cancel a payment atomically
export const cancelPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('CancelPayment validation failed', { errors: errors.array(), body: req.body });
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

    const { payment_id } = req.body;
    
    logInfo('Cancelling payment', { payment_id, requestId: req.requestId });

    const updatedPayment = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: payment_id },
      });

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
        data: {
          status: 'cancelled',
          cancelled_at: new Date(),
        },
      });
    });

    logInfo('Payment cancelled successfully', { paymentId: updatedPayment.id, status: updatedPayment.status });

    void createAuditLog({
      userId: updatedPayment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_CANCELLED',
      metadata: {},
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({
      success: true,
      data: { payment: updatedPayment },
    });
  } catch (error) {
    const err = error as Error & { statusCode?: number; from?: string };

    if (err.message === 'NOT_FOUND') {
      logWarn('Payment not found', { body: req.body });
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Payment not found' },
      });
      return;
    }

    if (err.message === 'INVALID_TRANSITION') {
      logWarn('Invalid transition attempt: cancel', { payment_id: req.body.payment_id, from: err.from });
      void createAuditLog({
        userId: req.userId ?? 'unknown',
        paymentId: req.body.payment_id,
        eventType: 'INVALID_TRANSITION_ATTEMPT',
        metadata: { from: err.from, to: 'cancelled' },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
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
    
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(410).json({
          success: false,
          error: {
            code: 'PAYMENT_MODIFIED',
            message: 'Payment was modified or deleted during cancellation',
          },
        });
        return;
      }
    }
    
    if (error instanceof PrismaClientInitializationError || 
        error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
        },
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to cancel payment',
      },
    });
  }
};

// Fail a payment
export const failPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logWarn('FailPayment validation failed', { errors: errors.array(), body: req.body });
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

    const { payment_id, reason } = req.body;
    
    logInfo('Failing payment', { payment_id, reason, requestId: req.requestId });

    const payment = await prisma.payment.findUnique({
      where: { id: payment_id },
    });

    if (!payment) {
      logWarn('Payment not found', { payment_id });
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Payment not found',
        },
      });
      return;
    }

    if (!isTransitionAllowed(payment.status, 'failed')) {
      logWarn('Invalid transition attempt: fail', { payment_id, from: payment.status });
      void createAuditLog({
        userId: payment.user_id,
        paymentId: payment_id,
        eventType: 'INVALID_TRANSITION_ATTEMPT',
        metadata: { from: payment.status, to: 'failed' },
        ipAddress: getClientIp(req),
        requestId: req.requestId,
      });
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

    logInfo('Payment failed successfully', { paymentId: updatedPayment.id, status: updatedPayment.status });

    void createAuditLog({
      userId: payment.user_id,
      paymentId: payment_id,
      eventType: 'PAYMENT_FAILED',
      metadata: { reason },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.json({
      success: true,
      data: { payment: updatedPayment },
    });
  } catch (error) {
    logError('FailPayment error', { error: (error as Error).message });
    
    if (error instanceof PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        res.status(410).json({
          success: false,
          error: {
            code: 'PAYMENT_MODIFIED',
            message: 'Payment was modified or deleted during failure recording',
          },
        });
        return;
      }
    }
    
    if (error instanceof PrismaClientInitializationError || 
        error instanceof PrismaClientRustPanicError) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
        },
      });
      return;
    }
    
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to record payment failure',
      },
    });
  }
};

