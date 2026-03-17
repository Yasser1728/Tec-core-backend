import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { logWarn, logError } from '../utils/logger';

interface TokenPayload extends JwtPayload {
  sub?: string;
  id?: string;
  userId?: string;
  role?: string;
  sessionId?: string;
}

/** Clock tolerance (seconds) */
const getClockTolerance = (): number =>
  parseInt(process.env.JWT_CLOCK_TOLERANCE ?? '5', 10);

/** Safe decode header */
function decodeHeader(token: string): { alg?: string } | null {
  try {
    const [headerB64] = token.split('.');
    const json = Buffer.from(headerB64, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Extract Bearer token safely */
function extractToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export const jwtMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const token = extractToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Token missing' },
    });
    return;
  }

  // 🔒 Pre-check algorithm
  const header = decodeHeader(token);
  if (!header || header.alg !== 'HS256') {
    logWarn('JWT rejected: invalid algorithm', { alg: header?.alg });
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid token' },
    });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    logError('JWT_SECRET not set');
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Server misconfiguration' },
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      clockTolerance: getClockTolerance(),
    }) as TokenPayload;

    // 🔥 دعم كل formats (sub هو الأفضل)
    const userId = decoded.sub || decoded.id || decoded.userId;

    if (!userId) {
      logWarn('JWT rejected: missing user identifier');
      res.status(401).json({
        success: false,
        error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid token' },
      });
      return;
    }

    // ✅ Attach user
    req.userId = userId;
    req.user = {
      id: userId,
      role: decoded.role || 'user',
      sessionId: decoded.sessionId,
    };

    next();
  } catch (error: any) {
    // 🎯 تفريق الأخطاء (مهم جدًا للمراقبة)
    if (error.name === 'TokenExpiredError') {
      logWarn('JWT expired', { exp: error.expiredAt });
      res.status(401).json({
        success: false,
        error: { code: 'TOKEN_EXPIRED', message: 'Token expired' },
      });
      return;
    }

    logWarn('JWT verification failed', { message: error.message });

    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid token' },
    });
  }
};
