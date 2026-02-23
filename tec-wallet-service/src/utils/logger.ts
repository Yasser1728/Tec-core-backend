const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = levels[LOG_LEVEL] ?? levels['info'];

const log = (level: string, message: string, meta?: unknown): void => {
  if ((levels[level] ?? 0) <= currentLevel) {
    const entry = { level, message, timestamp: new Date().toISOString(), ...(meta ? { meta } : {}) };
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
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
