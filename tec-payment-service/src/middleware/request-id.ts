/**
 * Request correlation middleware.
 *
 * Reads the incoming `x-request-id` header or generates a new UUID v4.
 * The value is stored on `req.headers['x-request-id']` and echoed back
 * as a response header so callers can correlate logs and traces end-to-end.
 *
 * Note: the payment service already had a requestId middleware in
 * src/middlewares/requestId.middleware.ts. This canonical version in
 * src/middleware/ is imported by app.ts going forward.
 */
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const requestIdMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const existing = req.headers['x-request-id'];
  const id =
    typeof existing === 'string' && existing.length > 0 ? existing : randomUUID();

  req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);
  next();
};
