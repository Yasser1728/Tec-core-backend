import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import paymentRoutes from './routes/payment.routes';
import { requestIdMiddleware } from './middleware/request-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './infra/metrics';
import { initSentry } from './infra/observability';
import { errorMiddleware } from './middlewares/error.middleware';
import { initIdempotencyStore } from './middlewares/idempotency.middleware';
import { logger } from './utils/logger';

dotenv.config();

// Initialise Sentry before anything else so errors during startup are captured.
initSentry();

const app: Application = express();

const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// ─── Security headers ─────────────────────────────────────────────────────────
// Explicitly configure Helmet directives for defence-in-depth.
// Note: Expect-CT was removed from Helmet 7+ and deprecated by all major browsers
//       (Chrome 112+, April 2023). HSTS/certificate transparency via CAA DNS records
//       is the recommended modern alternative.
app.use(
  helmet({
    // Prevent information leakage via the Referer header
    referrerPolicy: { policy: 'no-referrer' },
    // Strict Transport Security: require HTTPS for 1 year
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    // Minimal CSP for a JSON REST API — no HTML/scripts served
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Standard protections (on by default, made explicit here)
    xContentTypeOptions: true,
    xFrameOptions: { action: 'deny' },
    xDnsPrefetchControl: { allow: false },
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
// ALLOWED_ORIGINS (comma-separated) is preferred; CORS_ORIGIN is kept for
// backwards compatibility. Falls back to '*' when neither is set.
const parseCorsOrigins = (): string[] | string => {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw || raw === '*') return '*';
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
};
app.use(cors({
  origin: parseCorsOrigins(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Request correlation (X-Request-Id) ──────────────────────────────────────
app.use(requestIdMiddleware);

// ─── Observability: HTTP metrics tracking ─────────────────────────────────────
app.use(metricsMiddleware);

// ─── Idempotency store – initialise best available backend ────────────────────
// Uses Redis when REDIS_URL is set; falls back to in-memory otherwise.
initIdempotencyStore();
logger.info('Idempotency store initialised');

// ─── Global IP-based rate limiter (pre-authentication, applied to all routes) ─
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

// ─── Readiness probe ──────────────────────────────────────────────────────────
app.get('/ready', (_req, res) => {
  res.json({ status: 'ready', service: 'payment-service', timestamp: new Date().toISOString() });
});

// ─── Prometheus metrics endpoint ──────────────────────────────────────────────
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/payments', paymentRoutes);
app.use('/api/payments', paymentRoutes);

// ─── 404 handler ──────────────────────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use(errorMiddleware);

export default app;
