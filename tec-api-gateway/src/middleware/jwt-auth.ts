import { Request, Response, NextFunction } from 'express';
import { verify, JsonWebTokenError, TokenExpiredError } from 'jsonwebtoken';

// ── Routes لا تحتاج JWT ───────────────────────────────────
const PUBLIC_ROUTES: Array<string | RegExp> = [
  '/health',
  '/ready',
  '/metrics',
  '/api/docs',
  '/api/docs.json',
  '/api/cache/stats',
  '/api/v1/auth/pi-login',
  '/api/auth/pi-login',
  '/api/v1/auth/refresh',
  '/api/auth/refresh',
  '/api/v1/commerce/subscriptions/plans',
  /^\/api\/v1\/payments\/webhook/,
  /^\/api\/payments\/webhook/,
];

const isPublicRoute = (path: string): boolean =>
  PUBLIC_ROUTES.some(route =>
    typeof route === 'string'
      ? path === route || path.startsWith(route)
      : route.test(path),
  );

interface JwtPayload {
  sub:          string;
  exp:          number;
  iat:          number;
  pi_uid?:      string;
  pi_username?: string;
}

// ── Middleware ────────────────────────────────────────────
export const jwtAuthMiddleware = (
  req:  Request,
  res:  Response,
  next: NextFunction,
): void => {
  if (isPublicRoute(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: {
        code:      'UNAUTHORIZED',
        message:   'Missing or invalid Authorization header',
        requestId: req.headers['x-request-id'],
      },
    });
    return;
  }

  const token  = authHeader.replace('Bearer ', '');
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    res.status(500).json({
      success: false,
      error: {
        code:    'INTERNAL_ERROR',
        message: 'JWT secret not configured',
      },
    });
    return;
  }

  try {
    // ✅ verify() — يتحقق من التوقيع والصلاحية والـ algorithm
    const payload = verify(token, secret, {
      algorithms: ['HS256'],
    }) as JwtPayload;

    if (!payload.sub) {
      res.status(401).json({
        success: false,
        error: {
          code:      'INVALID_TOKEN',
          message:   'Token missing subject',
          requestId: req.headers['x-request-id'],
        },
      });
      return;
    }

    // ✅ Inject userId header للـ downstream services
    req.headers['x-user-id']     = payload.sub;
    req.headers['x-pi-uid']      = payload.pi_uid      ?? '';
    req.headers['x-pi-username'] = payload.pi_username ?? '';

    next();

  } catch (err) {
    if (err instanceof TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: {
          code:      'TOKEN_EXPIRED',
          message:   'Token has expired',
          requestId: req.headers['x-request-id'],
        },
      });
      return;
    }

    if (err instanceof JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: {
          code:      'INVALID_TOKEN',
          message:   'Token is invalid or tampered',
          requestId: req.headers['x-request-id'],
        },
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: {
        code:    'INTERNAL_ERROR',
        message: 'Token verification failed',
      },
    });
  }
};
