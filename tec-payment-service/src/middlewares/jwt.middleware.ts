import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logError } from '../utils/logger';

/** Shape of the JWT payload issued by the auth service. */
interface TokenPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

/**
 * Verifies the Bearer JWT in the Authorization header.
 * On success, attaches `req.userId` and `req.user.id` for downstream handlers.
 * On failure, returns HTTP 401.
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: { code: 'AUTHENTICATION_ERROR', message: 'No token provided' },
      });
      return;
    }

    const token = authHeader.substring(7); // strip 'Bearer '

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logError('JWT_SECRET is not configured');
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      return;
    }

    const decoded = jwt.verify(token, secret) as TokenPayload;
    req.userId = decoded.userId;
    req.user = { id: decoded.userId };
    next();
  } catch (_error) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
    });
  }
};
