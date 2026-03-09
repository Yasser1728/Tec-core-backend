import { timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import {
  PrismaClientKnownRequestError,
  PrismaClientInitializationError,
  PrismaClientRustPanicError,
} from '@prisma/client/runtime/library';
import { createAuditLog } from '../utils/audit';
import { logInfo, logWarn, logError } from '../utils/logger';
import { piCompletePayment, PiApiError } from '../services/payment.service';

// Helper to get client IP
const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'] as string | undefined;
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
};

/**
 * Validates that the incoming request carries the Pi API key either via:
 *   Authorization: Key <PI_API_KEY>
 * or the custom header:
 *   x-pi-key: <PI_API_KEY>
 *
 * Uses a constant-time comparison to prevent timing attacks.
 */
const validatePiApiKey = (req: Request): boolean => {
  const expected = process.env.PI_API_KEY;
  if (!expected) return false;

  const authHeader = req.headers['authorization'];
  const xPiKey = req.headers['x-pi-key'];

  const candidates: string[] = [];
  if (typeof authHeader === 'string') candidates.push(authHeader);
  if (typeof xPiKey === 'string') candidates.push(xPiKey);

  const expectedKey = `Key ${expected}`;

  for (const candidate of candidates) {
    if (candidate.length === expectedKey.length) {
      try {
        if (timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedKey))) return true;
      } catch {
        // length mismatch guard already handled above
      }
    }
    // Also accept bare key value in x-pi-key header
    if (candidate !== authHeader && candidate.length === expected.length) {
      try {
        if (timingSafeEqual(Buffer.from(candidate), Buffer.from(expected))) return true;
      } catch {
        // ignore
      }
    }
  }

  return false;
};

/**
 * POST /payments/webhook/incomplete
 *
 * Pi Network calls this endpoint when it detects a payment that was approved
 * on-chain but never completed by the developer (e.g. the user closed Pi
 * Browser before `onReadyForServerCompletion` fired).
 *
 * Auth: Pi API key via `Authorization: Key <PI_API_KEY>` or `x-pi-key` header.
 * No JWT required — the caller is Pi Network, not a user.
 */
export const handleIncompletePayment = async (req: Request, res: Response): Promise<void> => {
  // ─── Auth: validate Pi API key ──────────────────────────────────────────────
  if (!validatePiApiKey(req)) {
    res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Pi API key' },
    });
    return;
  }

  const piPaymentId: string | undefined = req.body?.payment?.identifier as string | undefined;

  // ─── Audit every received webhook ──────────────────────────────────────────
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

    // Write audit log regardless of whether we found the payment
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

    // ─── Idempotent: already completed or cancelled ─────────────────────────
    if (payment.status === 'completed' || payment.status === 'cancelled') {
      logInfo('Webhook: payment already in terminal status, no action needed', {
        paymentId: payment.id,
        status: payment.status,
        piPaymentId,
      });
      res.status(200).json({ success: true });
      return;
    }

    // ─── Only process payments stuck in `approved` status ───────────────────
    if (payment.status !== 'approved') {
      logWarn('Webhook: payment in unexpected status, skipping', {
        paymentId: payment.id,
        status: payment.status,
        piPaymentId,
      });
      res.status(200).json({ success: true });
      return;
    }

    // ─── Call Pi Network to complete the payment ─────────────────────────────
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

    // ─── Mark as completed in DB (atomic) ───────────────────────────────────
    // Use $transaction with a secondary state check to guard against concurrent
    // state changes that may have occurred while the Pi API call was in flight.
    const updatedPayment = await prisma.$transaction(async (tx) => {
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
      // State changed concurrently — still return 200 to Pi Network
      // so it doesn't retry the webhook.
      res.status(200).json({ success: true });
      return;
    }

    logInfo('Webhook: payment completed successfully', { paymentId: updatedPayment.id, piPaymentId });

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
          message: 'Database connection failed. Please check DATABASE_URL configuration.',
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
