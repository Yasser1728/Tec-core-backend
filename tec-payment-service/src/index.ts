import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import paymentRoutes from './routes/payment.routes';
import { requestId } from './middlewares/requestId.middleware';
import { errorMiddleware } from './middlewares/error.middleware';
import { initIdempotencyStore } from './middlewares/idempotency.middleware';
import { logger } from './utils/logger';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5003;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// ─── Security headers (Helmet advanced policies) ─────────────────────────────
app.use(
  helmet({
    // Content-Security-Policy: lock down resource origins to self only.
    // APIs don't serve HTML, but defence-in-depth still applies.
    contentSecurityPolicy: {
      directives: {
        defaultSrc:  ["'self'"],
        scriptSrc:   ["'self'"],
        styleSrc:    ["'self'"],
        imgSrc:      ["'self'"],
        connectSrc:  ["'self'"],
        frameSrc:    ["'none'"],
        objectSrc:   ["'none'"],
        baseUri:     ["'self'"],
        formAction:  ["'self'"],
      },
    },
    // HTTP Strict-Transport-Security: force HTTPS for 1 year.
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    // X-Frame-Options: DENY – prevents clickjacking.
    frameguard:  { action: 'deny' },
    // X-Content-Type-Options: nosniff – prevents MIME-type sniffing.
    noSniff:     true,
    // X-DNS-Prefetch-Control: off – prevents DNS prefetch leakage.
    dnsPrefetchControl: { allow: false },
    // Referrer-Policy: no-referrer – don't leak referrer URLs.
    referrerPolicy: { policy: 'no-referrer' },
    // X-Permitted-Cross-Domain-Policies: none.
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    // Disable X-Powered-By header.
    hidePoweredBy: true,
  })
);

// ─── CORS: allow only origins listed in ALLOWED_ORIGINS (or CORS_ORIGIN) ─────
const parseCorsOrigins = (): string[] | string => {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw || raw === '*') {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('ALLOWED_ORIGINS is not set – all origins are permitted (not recommended for production)');
    }
    return '*';
  }
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
};

app.use(
  cors({
    origin: parseCorsOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-request-id'],
  })
);

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Request correlation – assign/propagate x-request-id ─────────────────────
app.use(requestId);

// ─── Idempotency store – initialise best available backend ────────────────────
// Uses Redis when REDIS_URL is set; falls back to in-memory otherwise.
initIdempotencyStore();

// ─── Global IP-based rate limiter (pre-authentication, applied to all routes) ─
// Prevents brute-force and DDoS at the entry point.  Per-user limits are
// applied per-route (after JWT verification) for finer-grained control.
app.use(
  rateLimit({
    windowMs:        parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS ?? '60000', 10),
    max:             parseInt(process.env.RATE_LIMIT_GLOBAL_MAX ?? '200', 10),
    standardHeaders: true,
    legacyHeaders:   false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please retry after the window resets.',
      },
    },
  })
);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  res.json({
    status: 'ok',
    service: 'payment-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/payments', paymentRoutes);
app.use('/api/payments', paymentRoutes);

// ─── 404 handler ─────────────────────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorMiddleware);

app.listen(PORT, () => {
  logger.info(`💳 Payment Service running on port ${PORT}`);
});

export default app;
