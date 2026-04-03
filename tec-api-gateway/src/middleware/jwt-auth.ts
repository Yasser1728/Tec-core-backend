import { Request, Response, NextFunction } from 'express';

// ── Routes لا تحتاج JWT ───────────────────────────────────
const PUBLIC_ROUTES: Array<string | RegExp> = [
  '/health',
  '/ready',
  '/metrics',
  '/api/docs',
  '/api/docs.json',
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

// ── JWT decode (بدون verify — الـ verify في الـ service) ──
interface JwtPayload {
  sub:          string;
  exp:          number;
  iat:          number;
  pi_uid?:      string;
  pi_username?: string;
}

const decodeJwt = (token: string): JwtPayload | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload) as JwtPayload;
  } catch {
    return null;
  }
};

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

  const token   = authHeader.replace('Bearer ', '');
  const payload = decodeJwt(token);

  if (!payload) {
    res.status(401).json({
      success: false,
      error: {
        code:      'INVALID_TOKEN',
        message:   'Token is malformed',
        requestId: req.headers['x-request-id'],
      },
    });
    return;
  }

  // ── Check expiry ──────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
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

  // ── Inject userId header للـ downstream services ──────
  if (payload.sub) {
    req.headers['x-user-id']     = payload.sub;
    req.headers['x-pi-uid']      = payload.pi_uid      ?? '';
    req.headers['x-pi-username'] = payload.pi_username ?? '';
  }

  next();
};
