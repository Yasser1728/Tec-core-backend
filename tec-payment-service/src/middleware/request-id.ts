/**
 * Request correlation middleware.
 *
 * Reads the incoming `x-request-id` header or generates a new UUID v4.
 * Sets `req.requestId`, `req.headers['x-request-id']`, and echoes the
 * value back as a response header for end-to-end correlation.
 */
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const existing = req.headers['x-request-id'];
  const id =
    typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();

  req.headers['x-request-id'] = id;
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
};
