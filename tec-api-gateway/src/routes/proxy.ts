import { Router } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

const router = Router();

// Service URLs from environment
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL || 'http://localhost:5002';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003';

// Proxy configuration options
const createProxyOptions = (target: string): Options => ({
  target,
  changeOrigin: true,
  pathRewrite: (path) => {
    // Remove /api prefix when forwarding to services
    return path.replace(/^\/api/, '');
  },
  onProxyReq: (_proxyReq, req) => {
    // Log proxy requests
    console.log(`[Proxy] ${req.method} ${req.path} → ${target}`);
  },
  onProxyRes: (proxyRes, req) => {
    // Log proxy responses
    console.log(`[Proxy] ${req.method} ${req.path} ← ${proxyRes.statusCode}`);
  },
  onError: (err, req, res) => {
    console.error(`[Proxy Error] ${req.method} ${req.path}:`, err.message);
    res.status(503).json({
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable',
      },
    });
  },
});

// Auth Service routes: /api/auth/*
router.use(
  '/auth',
  createProxyMiddleware(createProxyOptions(AUTH_SERVICE_URL))
);

// Wallet Service routes: /api/wallets/*
router.use(
  '/wallets',
  createProxyMiddleware(createProxyOptions(WALLET_SERVICE_URL))
);

// Payment Service routes: /api/payments/*
router.use(
  '/payments',
  createProxyMiddleware(createProxyOptions(PAYMENT_SERVICE_URL))
);

export default router;