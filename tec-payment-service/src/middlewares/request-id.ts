import { Request, Response, NextFunction } from 'express';
import { randomUUID }                      from 'crypto';
import { requestContext }                  from '../infra/logger';

/**
 * Middleware: injects X-Request-ID into AsyncLocalStorage
 * so every log line in the request lifecycle includes requestId.
 */
export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const requestId =
    (req.headers['x-request-id'] as string) ?? randomUUID();

  // ── Echo requestId in response ────────────────────────
  res.setHeader('x-request-id', requestId);

  // ── Run rest of request inside context ────────────────
  requestContext.run({ requestId }, () => next());
};
