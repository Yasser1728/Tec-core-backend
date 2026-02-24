/**
 * Structured logger for the Payment Service.
 * Delegates to the Pino-backed infra logger.
 */

export interface LogContext {
  [key: string]: unknown;
}

// Re-export the Pino-backed logger (maintains object-style API).
export { logger } from '../infra/logger';
import { logger } from '../infra/logger';

export const logInfo  = (message: string, meta?: LogContext): void => logger.info(message,  meta as Record<string, unknown> | undefined);
export const logWarn  = (message: string, meta?: LogContext): void => logger.warn(message,  meta as Record<string, unknown> | undefined);
export const logError = (message: string, meta?: LogContext): void => logger.error(message, meta as Record<string, unknown> | undefined);
export const logDebug = (message: string, meta?: LogContext): void => logger.debug(message, meta as Record<string, unknown> | undefined);
