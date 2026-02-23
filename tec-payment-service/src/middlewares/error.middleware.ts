/**
 * Global error-handling middleware.
 *
 * Returns a generic message to avoid leaking implementation details to clients.
 */
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export const errorMiddleware = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
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
