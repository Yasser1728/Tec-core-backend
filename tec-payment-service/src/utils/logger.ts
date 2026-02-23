/**
 * Structured logger for the Payment Service.
 * Emits JSON log lines to stdout/stderr, filtered by LOG_LEVEL.
 */

export interface LogContext {
  [key: string]: unknown;
}

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const levels: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = levels[LOG_LEVEL] ?? levels['info'];

const log = (level: string, message: string, meta?: LogContext): void => {
  if ((levels[level] ?? 0) <= currentLevel) {
    const entry = { level, message, timestamp: new Date().toISOString(), ...(meta ?? {}) };
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }
};

export const logInfo = (message: string, meta?: LogContext): void => log('info', message, meta);
export const logWarn = (message: string, meta?: LogContext): void => log('warn', message, meta);
export const logError = (message: string, meta?: LogContext): void => log('error', message, meta);
export const logDebug = (message: string, meta?: LogContext): void => log('debug', message, meta);
