import { Request, Response, NextFunction } from 'express';
import jwt  from 'jsonwebtoken';
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base:  { service: 'jwt-middleware' },
});

interface TokenPayload {
  sub?:         string;
  id?:          string;
  userId?:      string;
  role?:        string;
  sessionId?:   string;
  pi_uid?:      string;
  pi_username?: string;
  iat?:         number;
  exp?:         number;
}

const getClockTolerance = (): number =>
  parseInt(process.env.JWT_CLOCK_TOLERANCE ?? '30', 10);

function decodeHeader(token: string): { alg?: string } | null {
  try {
    const [headerB64] = token.split('.');
    const json = Buffer.from(headerB64, 'base64url').toString('utf8');
    return JSON.parse(json) as { alg?: string };
  } catch {
    return null;
  }
}

export const authenticate = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'No token provided' },
    });
    return;
  }

  const token = authHeader.substring(7);

  const header = decodeHeader(token);
  if (!header || header.alg !== 'HS256') {
    logger.warn({ alg: header?.alg }, 'JWT rejected: unsupported algorithm');
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
      algorithms:     ['HS256'],
      clockTolerance: getClockTolerance(),
    }) as TokenPayload;

    const userId = decoded.sub ?? decoded.id ?? decoded.userId;

    if (!userId) {
      logger.warn('JWT rejected: missing user identifier in payload');
      res.status(401).json({
        success: false,
        error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
      });
      return;
    }

    req.userId = userId;
    req.user   = { id: userId, role: decoded.role, sessionId: decoded.sessionId };
    next();

  } catch (error) {
    logger.warn({ message: (error as Error).message }, 'JWT verification failed');
    res.status(401).json({
      success: false,
      error: { code: 'AUTHENTICATION_ERROR', message: 'Invalid or expired token' },
    });
  }
};
