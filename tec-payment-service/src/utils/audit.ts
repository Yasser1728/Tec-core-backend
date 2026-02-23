import { PrismaClient } from '../../prisma/client';
import { prisma } from '../config/database';
import { logWarn } from './logger';

export type AuditEventType =
  | 'PAYMENT_INITIATED'
  | 'PAYMENT_APPROVED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_CANCELLED'
  | 'PAYMENT_FAILED'
  | 'INVALID_TRANSITION_ATTEMPT';

export interface AuditLogData {
  userId: string;
  paymentId?: string;
  eventType: AuditEventType;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  requestId?: string;
}

/**
 * Write an audit log entry.  Errors are swallowed so that audit failures never
 * block the main payment flow.
 */
export const createAuditLog = async (data: AuditLogData): Promise<void> => {
  try {
    await (prisma as PrismaClient).paymentAuditLog.create({
      data: {
        userId: data.userId,
        paymentId: data.paymentId,
        eventType: data.eventType,
        metadata: (data.metadata ?? {}) as object,
        ipAddress: data.ipAddress,
        requestId: data.requestId,
        timestamp: new Date(),
      },
    });
  } catch (err) {
    logWarn('Failed to create audit log', {
      ...data,
      error: (err as Error).message,
    });
  }
};
