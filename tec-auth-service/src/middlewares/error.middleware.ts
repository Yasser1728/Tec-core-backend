import { Request, Response, NextFunction } from 'express';
import { logger } from '../infra/logger';
import { Sentry, isSentryEnabled } from '../infra/observability';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (isSentryEnabled()) {
    Sentry.captureException(err);
  }
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    requestId: req.headers['x-request-id'],
  });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
};
