/**
 * Audit logging utility for the Payment Service.
 *
 * Writes structured audit log entries to the database for security-sensitive
 * payment operations, providing an immutable trail for compliance and debugging.
 *
 * On database errors the failure is logged but never propagated — audit logging
 * must never block the main payment flow.
 */
import type { Prisma } from '../../prisma/client';
import { prisma } from '../config/database';
import { logError, logInfo } from './logger';

export interface AuditContext {
  action: string;
  entity: string;
  entityId: string;
  userId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Write an audit log entry to the database.
 * Failures are caught and logged; they never throw.
 */
export const writeAuditLog = async (ctx: AuditContext): Promise<void> => {
  try {
    await prisma.auditLog.create({
      data: {
        action: ctx.action,
        entity: ctx.entity,
        entity_id: ctx.entityId,
        user_id: ctx.userId,
        before: ctx.before,
        after: ctx.after,
        metadata: ctx.metadata,
      },
    });
    logInfo('Audit log written', { action: ctx.action, entity: ctx.entity, entityId: ctx.entityId });
  } catch (err) {
    logError('Failed to write audit log', { message: (err as Error).message, action: ctx.action, entity: ctx.entity });
  }
};
