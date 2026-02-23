/** Structured logger for the payment service. */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = levels[LOG_LEVEL] ?? levels['info'];

const log = (level: string, message: string, meta?: unknown): void => {
  if ((levels[level] ?? 0) <= currentLevel) {
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(meta ? { meta } : {}),
    };
    if (level === 'error') {
      console.error(JSON.stringify(entry));
    } else if (level === 'warn') {
      console.warn(JSON.stringify(entry));
    } else {
      console.log(JSON.stringify(entry));
    }
  }
};

export const logger = {
  error: (message: string, meta?: unknown) => log('error', message, meta),
  warn:  (message: string, meta?: unknown) => log('warn',  message, meta),
  info:  (message: string, meta?: unknown) => log('info',  message, meta),
  debug: (message: string, meta?: unknown) => log('debug', message, meta),
};
