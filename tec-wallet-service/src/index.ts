import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import walletRoutes from './routes/wallet.routes';
import { logger } from './utils/logger';
import { requestIdMiddleware } from './middleware/request-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './infra/metrics';
import { initSentry } from './infra/observability';
import { env } from './config/env';

dotenv.config();

// Initialise Sentry before anything else so errors during startup are captured.
initSentry();

const app: Application = express();
const PORT = env.PORT;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// ─── Security headers ────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    frameguard: { action: 'deny' },          // X-Frame-Options: DENY
    noSniff: true,                            // X-Content-Type-Options: nosniff
    xssFilter: true,
    hsts: { maxAge: 31536000, includeSubDomains: true },
  })
);

// ─── CORS: allow only origins listed in ALLOWED_ORIGINS (or CORS_ORIGIN) env ──
const parseCorsOrigins = (): string[] | string => {
  // ALLOWED_ORIGINS is the preferred env var; CORS_ORIGIN is kept for backwards compat.
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw || raw === '*') return '*';
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
};

const allowedOrigins = parseCorsOrigins();

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

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
    service: 'wallet-service',
    timestamp: new Date().toISOString(),
    uptime,
    version: SERVICE_VERSION,
  });
});

// Readiness probe.
app.get('/ready', (_req, res) => {
  res.json({ status: 'ready', service: 'wallet-service', timestamp: new Date().toISOString() });
});

// Prometheus metrics endpoint.
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// Routes
app.use('/wallets', walletRoutes);
app.use('/api/wallets', walletRoutes);

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
  logger.error('Wallet Service Error', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

app.listen(PORT, () => {
  logger.info(`💰 Wallet Service running on port ${PORT}`);
});

export default app;
