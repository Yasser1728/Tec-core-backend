import { Router } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';
import { injectInternalKey } from '../middleware/internal-auth';

const router = Router();

const AUTH_SERVICE_URL         = process.env.AUTH_SERVICE_URL         || 'http://localhost:5001';
const WALLET_SERVICE_URL       = process.env.WALLET_SERVICE_URL       || 'http://localhost:5002';
const PAYMENT_SERVICE_URL      = process.env.PAYMENT_SERVICE_URL      || 'http://localhost:5003';
const COMMERCE_SERVICE_URL     = process.env.COMMERCE_SERVICE_URL     || 'https://commerce-service-production.up.railway.app';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'https://notification-service-production-dc81.up.railway.app';

const createProxyOptions = (target: string): Options => ({
  target,
  changeOrigin: true,
  pathRewrite: (path) => path.replace(/^\/api/, ''),
  onProxyReq: (proxyReq, req) => {
    const requestId = req.headers['x-request-id'];
    if (requestId) proxyReq.setHeader('x-request-id', requestId);
  },
  onProxyRes: (_proxyRes, _req) => {},
  onError: (err, req, res) => {
    console.error(`[Proxy Error] ${req.method} ${req.path}:`, err.message);
    res.status(503).json({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Service temporarily unavailable' },
    });
  },
});

// ── Auth Service ───────────────────────────────────────────────
router.use('/auth',          injectInternalKey, createProxyMiddleware(createProxyOptions(AUTH_SERVICE_URL)));
router.use('/subscriptions', injectInternalKey, createProxyMiddleware(createProxyOptions(AUTH_SERVICE_URL)));
router.use('/kyc',           injectInternalKey, createProxyMiddleware(createProxyOptions(AUTH_SERVICE_URL)));
router.use('/security',      injectInternalKey, createProxyMiddleware(createProxyOptions(AUTH_SERVICE_URL)));
router.use('/profile',       injectInternalKey, createProxyMiddleware(createProxyOptions(AUTH_SERVICE_URL)));

// ── Wallet Service ─────────────────────────────────────────────
router.use('/wallets', injectInternalKey, createProxyMiddleware(createProxyOptions(WALLET_SERVICE_URL)));

// ── Payment Service ────────────────────────────────────────────
router.use('/payments/webhook', createProxyMiddleware(createProxyOptions(PAYMENT_SERVICE_URL)));
router.use('/payments',         injectInternalKey, createProxyMiddleware(createProxyOptions(PAYMENT_SERVICE_URL)));

// ── Commerce Service ──────────────────────────────────────────
router.use(
  '/commerce',
  injectInternalKey,
  createProxyMiddleware({
    target:       COMMERCE_SERVICE_URL,
    changeOrigin: true,
    pathRewrite:  { '^/api/commerce': '/commerce' },
    onProxyReq: (proxyReq, req) => {
      const auth = req.headers['authorization'];
      if (auth) proxyReq.setHeader('Authorization', String(auth));
      const secret = process.env.INTERNAL_SECRET;
      if (secret) proxyReq.setHeader('x-internal-key', secret);
      const requestId = req.headers['x-request-id'];
      if (requestId) proxyReq.setHeader('x-request-id', String(requestId));
    },
    onError: (_err, _req, res) => {
      res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Commerce service unavailable' },
      });
    },
  }),
);

// ── Notification Service ← جديد ──────────────────────────────
router.use(
  '/notification',
  injectInternalKey,
  createProxyMiddleware({
    target:       NOTIFICATION_SERVICE_URL,
    changeOrigin: true,
    pathRewrite:  { '^/api/notification': '/notifications' },
    onProxyReq: (proxyReq, req) => {
      const auth = req.headers['authorization'];
      if (auth) proxyReq.setHeader('Authorization', String(auth));
      const secret = process.env.INTERNAL_SECRET;
      if (secret) proxyReq.setHeader('x-internal-key', secret);
      const requestId = req.headers['x-request-id'];
      if (requestId) proxyReq.setHeader('x-request-id', String(requestId));
    },
    onError: (_err, _req, res) => {
      res.status(503).json({
        success: false,
        error: { code: 'SERVICE_UNAVAILABLE', message: 'Notification service unavailable' },
      });
    },
  }),
);

export default router;
