import { timingSafeEqual } from 'crypto';
import { Request, Response, NextFunction } from 'express';

/**
 * Validates the `x-internal-key` header against the `INTERNAL_SECRET`
 * environment variable.  Rejects with 403 if the header is missing or
 * does not match.
 *
 * Uses a constant-time comparison to avoid timing-based attacks.
 *
 * When `INTERNAL_SECRET` is not configured the middleware throws a hard error
 * in production to prevent accidental exposure of internal endpoints.  In
 * non-production environments it passes through to preserve local-dev
 * ergonomics.
 */
export const validateInternalKey = (req: Request, res: Response, next: NextFunction): void => {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('INTERNAL_SECRET must be configured in production');
    }
    // No secret configured — skip enforcement (safe for local dev).
    next();
    return;
  }

  const provided = req.headers['x-internal-key'];
  const isValid =
    typeof provided === 'string' &&
    provided.length === secret.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(secret));

  if (!isValid) {
    res.status(403).json({
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Missing or invalid internal key',
      },
    });
    return;
  }

  next();
};
