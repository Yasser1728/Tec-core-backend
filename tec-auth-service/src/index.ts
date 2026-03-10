import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import subscriptionRoutes from './routes/subscription.routes';
import kycRoutes from './routes/kyc.routes';
import securityRoutes from './routes/security.routes';
import profileRoutes from './routes/profile.routes';
import { rateLimitMiddleware } from './middlewares/rate-limit.middleware';
import { validateInternalKey } from './middleware/internal-auth';
import { requestIdMiddleware } from './middleware/request-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './infra/metrics';
import { initSentry } from './infra/observability';
import { logger } from './infra/logger';
import { env } from './config/env';

dotenv.config();

// Initialise Sentry before anything else so errors during startup are captured.
initSentry();

const app: Application = express();
const PORT = env.PORT;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// Security middleware
app.use(helmet());

// CORS — ALLOWED_ORIGINS (comma-separated) takes priority; falls back to CORS_ORIGIN.
// Default is false (deny all cross-origin requests) when neither is set.
const parseCorsOrigins = (): string | string[] | false => {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw) return false;
  if (raw === '*') return '*';
  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);
  return origins.length > 0 ? origins : false;
};
app.use(cors({
  origin: parseCorsOrigins(),
  credentials: true,
  // Explicitly list allowed methods so CORS preflight (OPTIONS) is handled correctly
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  // Explicitly list headers that clients may send (including Authorization for JWT)
  allowedHeaders: ['Content-Type', 'Authorization'],
  // preflightContinue: false (default) — cors() responds to OPTIONS itself
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Observability middleware ─────────────────────────────────────────────────
app.use(requestIdMiddleware);
app.use(metricsMiddleware);

// Health check
app.get('/health', (_req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  res.json({
    status: 'ok',
    service: 'auth-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  });
});

// Pi Platform connectivity check — verifies that the Pi Network API is reachable.
// Does not expose secrets; only reports success/failure and the resolved base URL.
app.get('/health/pi', async (_req, res) => {
  const piBase = process.env.PI_PLATFORM_BASE_URL
    ?? (process.env.PI_SANDBOX === 'false'
      ? 'https://api.minepi.com'
      : 'https://api.sandbox.minepi.com');
  try {
    const response = await fetch(`${piBase}/v2/me`, {
      signal: AbortSignal.timeout(5000),
    });
    // Any HTTP response (including 401) means the host is reachable
    res.json({
      success: true,
      piBaseUrl: piBase,
      httpStatus: response.status,
    });
  } catch (err) {
    const errCode = (err as NodeJS.ErrnoException).code ?? '';
    const errMsg = (err as Error).message ?? String(err);
    const isTimeout = (err as Error).name === 'TimeoutError' || errCode === 'ABORT_ERR';
    res.status(503).json({
      success: false,
      piBaseUrl: piBase,
      error: isTimeout ? 'Pi Platform API did not respond within 5 seconds' : errMsg,
    });
  }
});

// Readiness probe.
app.get('/ready', (_req, res) => {
  res.json({ status: 'ready', service: 'auth-service', timestamp: new Date().toISOString() });
});

// Prometheus metrics endpoint.
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Routes — internal-key validation applied to all routes; rate limiter applied to /auth endpoints
app.use(validateInternalKey);
app.use('/auth', rateLimitMiddleware, authRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/kyc', kycRoutes);
app.use('/security', securityRoutes);
app.use('/profile', profileRoutes);
app.use('/api/auth', rateLimitMiddleware, authRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/kyc', kycRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/profile', profileRoutes);

// 404 handler
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Auth Service Error', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

app.listen(PORT, () => {
  logger.info(`🔐 Auth Service running on port ${PORT}`);
});

export default app;
