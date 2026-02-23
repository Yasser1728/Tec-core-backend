/**
 * Request correlation middleware.
 *
 * Reads the incoming `x-request-id` header or generates a new UUID v4.
 * The value is stored on `req.headers['x-request-id']` and echoed back as a
 * response header so callers can correlate logs and traces end-to-end.
 */
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

export const requestId = (_req: Request, res: Response, next: NextFunction): void => {
  const existing = _req.headers['x-request-id'];
  const id =
    typeof existing === 'string' && existing.length > 0
      ? existing
      : uuidv4();

  // Normalise to a plain string so downstream code can always do `req.headers['x-request-id'] as string`.
  _req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);
  next();
};
