/**
 * HTTP request logging middleware.
 *
 * Uses pino-http to emit structured JSON log lines (one per request/response).
 * Replaces the previous console.log + morgan approach.
 * Sensitive headers are redacted before logging.
 */
import { randomUUID } from 'crypto';
import PinoHttp from 'pino-http';
import pinoInstance from '../infra/logger';

export const httpLogger = PinoHttp({
  logger: pinoInstance,
  // Include requestId from the x-request-id header in each log line.
  genReqId: (req) => {
    const id = req.headers['x-request-id'];
    return (typeof id === 'string' && id.length > 0 ? id : randomUUID()) as string;
  },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  // Suppress logging for health/ready/metrics probes to reduce noise.
  autoLogging: {
    ignore: (req) => {
      const path = req.url ?? '';
      return path === '/health' || path === '/ready' || path === '/metrics';
    },
  },
});

/**
 * Legacy named export kept for any existing imports.
 * @deprecated Use `httpLogger` instead.
 */
export const logger = httpLogger;