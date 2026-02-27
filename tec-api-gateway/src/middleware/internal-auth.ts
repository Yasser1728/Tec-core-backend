import { Request, Response, NextFunction } from 'express';

/**
 * Injects the `x-internal-key` header on all proxied requests so downstream
 * services can verify the request originated from the gateway.
 *
 * The secret is read exclusively from the `INTERNAL_SECRET` environment
 * variable — never hard-coded.
 */
export const injectInternalKey = (req: Request, _res: Response, next: NextFunction): void => {
  const secret = process.env.INTERNAL_SECRET;
  if (secret) {
    req.headers['x-internal-key'] = secret;
  }
  next();
};
