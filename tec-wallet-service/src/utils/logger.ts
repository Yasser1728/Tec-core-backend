// Re-export the Pino-backed logger for backward compatibility,
// extended with the wallet-specific `operation` helper.
import { logger as pinoLogger } from '../infra/logger';

const log = (level: string, message: string, meta?: unknown): void => {
  const m = meta as Record<string, unknown> | undefined;
  switch (level) {
    case 'error': pinoLogger.error(message, m); break;
    case 'warn':  pinoLogger.warn(message, m);  break;
    case 'debug': pinoLogger.debug(message, m); break;
    default:      pinoLogger.info(message, m);  break;
  }
};

/** Phases of a financial operation for structured tracing. */
export type OperationPhase = 'init' | 'verify' | 'commit' | 'rollback';

/**
 * Emit a structured log entry for a financial operation phase.
 * @param operation - Name of the operation (e.g. "transfer", "deposit")
 * @param phase     - Lifecycle phase: init | verify | commit | rollback
 * @param meta      - Additional context (userId, walletId, amount, etc.)
 */
const logOperation = (operation: string, phase: OperationPhase, meta?: unknown): void => {
  const level = phase === 'rollback' ? 'error' : 'info';
  log(level, `[${operation.toUpperCase()}] phase=${phase}`, meta);
};

export const logger = {
  error: (message: string, meta?: unknown) => log('error', message, meta),
  warn: (message: string, meta?: unknown) => log('warn', message, meta),
  info: (message: string, meta?: unknown) => log('info', message, meta),
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
  operation: logOperation,
};
