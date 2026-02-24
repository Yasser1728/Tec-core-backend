/**
 * Pino-based structured logger for the Auth Service.
 *
 * Replaces console-based JSON logging with a single Pino logger.
 * Redacts sensitive fields so they never appear in production logs.
 * Log level is driven by the LOG_LEVEL env var (default: info).
 * Debug level is automatically suppressed when NODE_ENV=production
 * and LOG_LEVEL is not explicitly set.
 */
import pino from 'pino';

const isProd = (process.env.NODE_ENV ?? 'production') === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

const pinoInstance = pino({
  level: LOG_LEVEL,
  redact: {
    paths: [
      'password',
      'token',
      'secret',
      'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-auth-token"]',
      '*.password',
      '*.token',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: process.env.SERVICE_NAME ?? 'auth-service' },
}, process.stdout);

/**
 * Wrapped logger that keeps the existing call signature:
 *   logger.info(message, meta?)
 * so the rest of the codebase doesn't need to change.
 */
export const logger = {
  error: (message: string, meta?: Record<string, unknown>) => {
    if (meta) pinoInstance.error({ ...meta }, message);
    else pinoInstance.error(message);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    if (meta) pinoInstance.warn({ ...meta }, message);
    else pinoInstance.warn(message);
  },
  info: (message: string, meta?: Record<string, unknown>) => {
    if (meta) pinoInstance.info({ ...meta }, message);
    else pinoInstance.info(message);
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (meta) pinoInstance.debug({ ...meta }, message);
    else pinoInstance.debug(message);
  },
};

/** Raw pino instance — for child loggers and pino-http. */
export default pinoInstance;
