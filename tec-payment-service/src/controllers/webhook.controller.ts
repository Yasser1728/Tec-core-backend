import { createHmac, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { Prisma } from '@prisma/client';
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
  PrismaClientRustPanicError,
} from '@prisma/client/runtime/library';
import { createAuditLog } from '../utils/audit';
import { logInfo, logWarn, logError } from '../utils/logger';
import { piCompletePayment, PiApiError } from '../services/payment.service';

type TransactionClient = Prisma.TransactionClient;

const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
};

/**
 * Validates Pi Network HMAC-SHA256 signature.
 * Pi Network sends: x-pi-signature: sha256={hmac_hex}
 * We verify: HMAC-SHA256(PI_WEBHOOK_SECRET, rawBody) === provided_hmac
 */
const validatePiSignature = (req: Request): boolean => {
  const secret = process.env.PI_WEBHOOK_SECRET;
  if (!secret) {
    logWarn('PI_WEBHOOK_SECRET not set — webhook signature validation skipped');
    return false;
  }

  const signatureHeader = req.headers['x-pi-signature'] as string | undefined;
  if (!signatureHeader) {
    logWarn('Webhook: missing x-pi-signature header');
    return false;
  }

  // Expected format: sha256={hex_digest}
  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) {
    logWarn('Webhook: invalid signature format', { signatureHeader });
    return false;
  }

  const providedHmac = signatureHeader.slice(prefix.length);

  // rawBody must be set by express.raw() middleware BEFORE json parsing
  const rawBody: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logWarn('Webhook: rawBody not available — ensure express.raw() middleware is applied');
    return false;
  }

  const expectedHmac = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  if (providedHmac.length !== expectedHmac.length) return false;

  try {
    return timingSafeEqual(
      Buffer.from(providedHmac, 'hex'),
      Buffer.from(expectedHmac, 'hex'),
    );
  } catch {
    return false;
  }
};

export const handleIncompletePayment = async (req: Request, res: Response): Promise<void> => {
  if (!validatePiSignature(req)) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing Pi webhook signature' },
    });
    return;
  }

  const piPaymentId: string | undefined = req.body?.payment?.identifier as string | undefined;

  logInfo('Webhook received: incomplete payment', { piPaymentId, requestId: req.requestId });

  if (!piPaymentId || typeof piPaymentId !== 'string') {
    logWarn('Webhook: missing payment identifier in payload', { body: req.body });
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'payment.identifier is required' },
    });
    return;
  }

  try {
    const payment = await prisma.payment.findFirst({
      where: { pi_payment_id: piPaymentId },
    });

    void createAuditLog({
      userId: payment?.user_id ?? 'unknown',
      paymentId: payment?.id,
      eventType: 'PAYMENT_WEBHOOK_RECEIVED',
      metadata: { pi_payment_id: piPaymentId, payment_status: payment?.status ?? 'not_found' },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    if (!payment) {
      logWarn('Webhook: payment not found for pi_payment_id', { piPaymentId });
      res.status(200).json({ success: true });
      return;
    }

    if (payment.status === 'completed' || payment.status === 'cancelled') {
      logInfo('Webhook: payment already in terminal status, no action needed', {
        paymentId: payment.id,
        status: payment.status,
        piPaymentId,
      });
      res.status(200).json({ success: true });
      return;
    }

    if (payment.status !== 'approved') {
      logWarn('Webhook: payment in unexpected status, skipping', {
        paymentId: payment.id,
        status: payment.status,
        piPaymentId,
      });
      res.status(200).json({ success: true });
      return;
    }

    const txId: string | undefined = req.body?.payment?.transaction?.txid ?? undefined;

    try {
      await piCompletePayment(piPaymentId, txId);
    } catch (piErr) {
      if (piErr instanceof PiApiError) {
        logWarn('Webhook: Pi API complete failed', {
          paymentId: payment.id,
          piPaymentId,
          code: piErr.code,
          message: piErr.message,
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: 'failed', failed_at: new Date() },
        });
        void createAuditLog({
          userId: payment.user_id,
          paymentId: payment.id,
          eventType: 'PAYMENT_FAILED',
          metadata: { pi_payment_id: piPaymentId, reason: piErr.message, source: 'webhook' },
          ipAddress: getClientIp(req),
          requestId: req.requestId,
        });
        res.status(200).json({ success: true });
        return;
      }
      throw piErr;
    }

    const updatedPayment = await prisma.$transaction(async (tx: TransactionClient) => {
      const current = await tx.payment.findUnique({
        where: { id: payment.id },
      });

      if (!current || current.status !== 'approved') {
        logWarn('Webhook: payment state changed during Pi API call', {
          paymentId: payment.id,
          expectedStatus: 'approved',
          actualStatus: current?.status ?? 'not_found',
          piPaymentId,
        });
        return null;
      }

      return tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'completed',
          completed_at: new Date(),
          transaction_id: txId ?? null,
          metadata: {
            ...(typeof current.metadata === 'object' && current.metadata !== null
              ? (current.metadata as Record<string, unknown>)
              : {}),
            transaction_id: txId,
            completed_via: 'webhook',
          },
        },
      });
    });

    if (!updatedPayment) {
      res.status(200).json({ success: true });
      return;
    }

    logInfo('Webhook: payment completed successfully', {
      paymentId: updatedPayment.id,
      piPaymentId,
    });

    void createAuditLog({
      userId: updatedPayment.user_id,
      paymentId: updatedPayment.id,
      eventType: 'PAYMENT_CONFIRMED',
      metadata: { pi_payment_id: piPaymentId, transaction_id: txId, source: 'webhook' },
      ipAddress: getClientIp(req),
      requestId: req.requestId,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logError('Webhook: unexpected error', { error: (error as Error).message, piPaymentId });

    if (
      error instanceof PrismaClientInitializationError ||
      error instanceof PrismaClientRustPanicError ||
      (error instanceof PrismaClientKnownRequestError && error.code.startsWith('P1'))
    ) {
      res.status(503).json({
        success: false,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database connection failed.',
        },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to process webhook' },
    });
  }
};
