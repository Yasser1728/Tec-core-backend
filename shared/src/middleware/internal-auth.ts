import { timingSafeEqual }               from 'crypto';
import { Request, Response, NextFunction } from 'express';

export const validateInternalKey = (
  req:  Request,
  res:  Response,
  next: NextFunction,
): void => {
  const secret = process.env.INTERNAL_SECRET;
  if (!secret) {
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
        code:    'FORBIDDEN',
        message: 'Missing or invalid internal key',
      },
    });
    return;
  }

  next();
};
