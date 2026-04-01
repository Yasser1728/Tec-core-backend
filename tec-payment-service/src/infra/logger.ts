/**
 * Pino-based structured logger for the Payment Service.
 * Includes requestId propagation via AsyncLocalStorage.
 */
import pino                               from 'pino';
import { AsyncLocalStorage }              from 'async_hooks';

// ── Request Context Store ─────────────────────────────────
export interface RequestContext {
  requestId?: string;
  userId?:    string;
  service?:   string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

const isProd    = (process.env.NODE_ENV ?? 'production') === 'production';
const LOG_LEVEL = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');

const pinoInstance = pino({
  level: LOG_LEVEL,
  redact: {
    paths: [
      'password', 'token', 'secret', 'authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-auth-token"]',
      '*.password', '*.token', '*.secret',
    ],
    censor: '[REDACTED]',
  },
  formatters: {
    level(label) { return { level: label }; },
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: process.env.SERVICE_NAME ?? 'payment-service' },
}, process.stdout);

// ── Helper: inject requestId from context ─────────────────
const withContext = (meta?: Record<string, unknown>): Record<string, unknown> => {
  const ctx = requestContext.getStore();
  return {
    ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
    ...(ctx?.userId    ? { userId:    ctx.userId    } : {}),
    ...meta,
  };
};

// ── Wrapped logger ────────────────────────────────────────
export const logger = {
  error: (message: string, meta?: Record<string, unknown>) =>
    pinoInstance.error(withContext(meta), message),

  warn: (message: string, meta?: Record<string, unknown>) =>
    pinoInstance.warn(withContext(meta), message),

  info: (message: string, meta?: Record<string, unknown>) =>
    pinoInstance.info(withContext(meta), message),

  debug: (message: string, meta?: Record<string, unknown>) =>
    pinoInstance.debug(withContext(meta), message),

  // ── Operation trace (for saga/transfer phases) ──────────
  operation: (
    name:  string,
    phase: 'init' | 'verify' | 'commit' | 'rollback',
    meta?: Record<string, unknown>,
  ) => {
    const fn = phase === 'rollback' ? pinoInstance.error.bind(pinoInstance)
             : phase === 'commit'   ? pinoInstance.info.bind(pinoInstance)
             :                        pinoInstance.debug.bind(pinoInstance);
    fn(withContext(meta), `[${name.toUpperCase()}] phase=${phase}`);
  },
};

/** Raw pino instance — for child loggers and pino-http. */
export default pinoInstance;
