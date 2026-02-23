import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

/** Shape of the JWT payload issued by the auth service. */
interface TokenPayload {
  userId: string;
  iat?: number;
  exp?: number;
}

// Extend Express Request so downstream handlers can read the verified identity.
declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

/**
 * Verifies the Bearer JWT in the Authorization header.
 * On success, attaches `req.userId` for downstream handlers.
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
      // JWT_SECRET is a required configuration value; fail closed.
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      });
      return;
    }

    const decoded = jwt.verify(token, secret) as TokenPayload;
    req.userId = decoded.userId;
    next();
  } catch (_error) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
    });
  }
};
