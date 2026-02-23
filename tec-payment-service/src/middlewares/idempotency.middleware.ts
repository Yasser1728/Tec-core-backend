import { Request, Response, NextFunction } from 'express';
import { logWarn } from '../utils/logger';

/**
 * Idempotency middleware — placeholder for Idempotency-Key enforcement.
 *
 * When fully implemented this middleware will:
 *   1. Require an `Idempotency-Key` header on mutating requests.
 *   2. Cache responses keyed by (userId + Idempotency-Key).
 *   3. Return the cached response for duplicate requests instead of re-executing.
 *
 * For now it simply warns when the header is absent and passes the request through.
 */
export const idempotencyMiddleware = (req: Request, _res: Response, next: NextFunction): void => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    logWarn('Idempotency-Key header missing', { method: req.method, path: req.path });
  }
  next();
};
