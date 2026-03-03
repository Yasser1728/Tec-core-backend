import { prisma } from '../config/database';
import { createAuditLog } from '../utils/audit';
import { logInfo, logWarn, logError } from '../utils/logger';
import { env } from '../config/env';

export interface ReconciliationDetail {
  id: string;
  originalStatus: string;
  reconciledAt: Date;
}

export interface ReconciliationResult {
  reconciledCount: number;
  details: ReconciliationDetail[];
}

export const reconcileStalePayments = async (): Promise<ReconciliationResult> => {
  const now = new Date();
  const createdThresholdMs = env.RECONCILE_CREATED_THRESHOLD_MS;
  const approvedThresholdMs = env.RECONCILE_APPROVED_THRESHOLD_MS;

  const createdCutoff = new Date(now.getTime() - createdThresholdMs);
  const approvedCutoff = new Date(now.getTime() - approvedThresholdMs);

  logInfo('Starting stale payment reconciliation', {
    createdCutoff,
    approvedCutoff,
  });

  let stalePayments: { id: string; status: string; user_id: string }[] = [];

  try {
    stalePayments = await prisma.payment.findMany({
      where: {
        deleted_at: null,
        OR: [
          {
            status: 'created',
            created_at: { lt: createdCutoff },
          },
          {
            status: 'approved',
            OR: [
              { approved_at: { lt: approvedCutoff } },
              { approved_at: null, created_at: { lt: approvedCutoff } },
            ],
          },
        ],
      },
      select: {
        id: true,
        status: true,
        user_id: true,
      },
    });
  } catch (err) {
    logError('Reconciliation query failed', { error: (err as Error).message });
    throw err;
  }

  if (stalePayments.length === 0) {
    logInfo('No stale payments found');
    return { reconciledCount: 0, details: [] };
  }

  logWarn('Stale payments found', { count: stalePayments.length });

  const details: ReconciliationDetail[] = [];

  for (const payment of stalePayments) {
    const reconciledAt = new Date();
    try {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'failed',
          failed_at: reconciledAt,
          metadata: {
            reconciled: true,
            original_status: payment.status,
            reconciled_at: reconciledAt.toISOString(),
            reason: 'Stale payment auto-reconciled',
          },
        },
      });

      void createAuditLog({
        userId: payment.user_id,
        paymentId: payment.id,
        eventType: 'PAYMENT_RECONCILED',
        metadata: {
          original_status: payment.status,
          reconciled_at: reconciledAt.toISOString(),
          reason: 'Stale payment auto-reconciled',
        },
      });

      details.push({ id: payment.id, originalStatus: payment.status, reconciledAt });
      logInfo('Reconciled stale payment', { paymentId: payment.id, originalStatus: payment.status });
    } catch (err) {
      logError('Failed to reconcile payment', { paymentId: payment.id, error: (err as Error).message });
    }
  }

  logInfo('Reconciliation complete', { reconciledCount: details.length });
  return { reconciledCount: details.length, details };
};
