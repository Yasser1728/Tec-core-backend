/**
 * Log context for structured logging.
 * Attach userId to any log line that is scoped to a specific user.
 */
export interface LogContext {
  /** ID of the authenticated user performing the action, if available */
  userId?: string;
  [key: string]: unknown;
}

// Re-export the Pino-backed logger so the rest of the codebase keeps working.
export { logger } from '../infra/logger';
import { logger } from '../infra/logger';

export const logInfo = (message: string, meta?: LogContext): void => {
  logger.info(message, meta as Record<string, unknown> | undefined);
};

export const logWarn = (message: string, meta?: LogContext): void => {
  logger.warn(message, meta as Record<string, unknown> | undefined);
};

export const logError = (message: string, meta?: LogContext): void => {
  logger.error(message, meta as Record<string, unknown> | undefined);
};

// Audit log — records security-sensitive events with user context
export const logAudit = (action: string, context: LogContext): void => {
  logger.info(action, { level: 'audit', ...context } as Record<string, unknown>);
};
