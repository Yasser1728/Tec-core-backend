import { Request, Response, NextFunction } from 'express';
import { logError } from '../utils/logger';

export const errorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logError('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
};
