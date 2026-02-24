/**
 * JWT authentication middleware for the wallet service.
 *
 * Security guarantees:
 *  - Only HS256 tokens are accepted; `alg: none` and all other algorithms are
 *    rejected before the signature is verified.
 *  - A configurable `clockTolerance` (JWT_CLOCK_TOLERANCE env, default 0 s)
 *    is applied to guard against minor clock skew between services.
 *  - Attaches `req.user = { id, role, sessionId }` and `req.userId` for
 *    downstream handlers. Both `id` and legacy `userId` payload fields are
 *    supported.
 */
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

/** Shape of the JWT payload issued by the auth service. */
interface TokenPayload {
  id?: string;
  userId?: string;
  role?: string;
  sessionId?: string;
  iat?: number;
  exp?: number;
}

/** Clock tolerance in seconds applied when verifying token expiry. */
const getClockTolerance = (): number =>
  parseInt(process.env.JWT_CLOCK_TOLERANCE ?? '0', 10);

/**
 * Decode the JWT header without verifying it (to inspect `alg` before full
 * verification) or return null on malformed input.
 */
function decodeHeader(token: string): { alg?: string } | null {
  try {
    const [headerB64] = token.split('.');
    const json = Buffer.from(headerB64, 'base64url').toString('utf8');
    return JSON.parse(json) as { alg?: string };
  } catch {
    return null;
  }
}

/**
 * Verifies the Bearer JWT in the Authorization header.
 *
 * - Returns 401 for missing/invalid/expired tokens and unsupported algorithms.
 * - Returns 500 when JWT_SECRET is not configured.
 * - On success, attaches `req.userId` and `req.user = { id, role, sessionId }`.
 */
export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'No token provided' },
    });
    return;
  }

  const token = authHeader.substring(7); // strip 'Bearer '

  // Reject alg:none and non-HS256 tokens before signature verification.
  const header = decodeHeader(token);
  if (!header || header.alg !== 'HS256') {
    logger.warn('JWT rejected: unsupported algorithm', { alg: header?.alg });
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
    });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logger.error('JWT_SECRET environment variable is not set');
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      clockTolerance: getClockTolerance(),
    }) as TokenPayload;

    // Support both `id` and legacy `userId` payload fields.
    const userId = decoded.id ?? decoded.userId;
    if (!userId) {
      logger.warn('JWT rejected: missing user identifier in payload');
      res.status(401).json({
        success: false,
        error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
      });
      return;
    }

    req.userId = userId;
    req.user = { id: userId, role: decoded.role, sessionId: decoded.sessionId };
    next();
  } catch (error) {
    logger.warn('JWT verification failed', { message: (error as Error).message });
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
    });
  }
};
