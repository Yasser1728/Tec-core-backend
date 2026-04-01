import express, { Application }        from 'express';
import cors                            from 'cors';
import helmet                          from 'helmet';
import dotenv                          from 'dotenv';
import rateLimit                       from 'express-rate-limit';
import paymentRoutes                   from './routes/payment.routes';
import { requestIdMiddleware }         from './middlewares/request-id';
import { metricsMiddleware }           from './middlewares/metrics';
import { register }                    from './infra/metrics';
import { initSentry }                  from './infra/observability';
import { errorMiddleware }             from './middlewares/error.middleware';
import { initIdempotencyStore }        from './middlewares/idempotency.middleware';
import { validateInternalKey }         from './middlewares/internal-auth';
import { logger }                      from './utils/logger';
import { prisma }                      from './config/database';

dotenv.config();
initSentry();

const app: Application = express();

app.set('trust proxy', 1);

const SERVICE_VERSION  = process.env.SERVICE_VERSION  || '1.0.0';
const serviceStartTime = Date.now();

// ── Security headers ──────────────────────────────────────
app.use(
  helmet({
    referrerPolicy:           { policy: 'no-referrer' },
    strictTransportSecurity:  { maxAge: 31536000, includeSubDomains: true },
    contentSecurityPolicy:    { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    xContentTypeOptions:      true,
    xFrameOptions:            { action: 'deny' },
    xDnsPrefetchControl:      { allow: false },
  }),
);

// ── CORS ──────────────────────────────────────────────────
const parseCorsOrigins = (): string[] | string | false => {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw) return false;
  if (raw === '*') return '*';
  const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
  return origins.length > 0 ? origins : false;
};

app.use(cors({
  origin:         parseCorsOrigins(),
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
  exposedHeaders: ['X-Request-Id'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request ID + Metrics ──────────────────────────────────
// requestIdMiddleware يحقن requestId في AsyncLocalStorage
// → كل log في نفس الـ request هيطلع فيه requestId تلقائياً
app.use(requestIdMiddleware);
app.use(metricsMiddleware);

initIdempotencyStore();
logger.info('Idempotency store initialised');

// ── Rate Limiting ─────────────────────────────────────────
app.use(
  rateLimit({
    windowMs:        parseInt(process.env.RATE_LIMIT_GLOBAL_WINDOW_MS ?? '60000', 10),
    max:             parseInt(process.env.RATE_LIMIT_GLOBAL_MAX        ?? '200',   10),
    standardHeaders: true,
    legacyHeaders:   false,
    message: {
      success: false,
      error: {
        code:    'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please retry after the window resets.',
      },
    },
  }),
);

// ── Health ────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  let dbStatus     = 'ok';
  let dbLatencyMs: number | null = null;

  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
  } catch {
    dbStatus = 'error';
  }

  const isHealthy = dbStatus === 'ok';
  res.status(isHealthy ? 200 : 503).json({
    status:    isHealthy ? 'ok' : 'degraded',
    service:   'payment-service',
    timestamp: new Date().toISOString(),
    uptime,
    version:   SERVICE_VERSION,
    checks: {
      database: { status: dbStatus, latencyMs: dbLatencyMs },
    },
  });
});

// ── Ready ─────────────────────────────────────────────────
app.get('/ready', (_req, res) => {
  res.json({ status: 'ready', service: 'payment-service', timestamp: new Date().toISOString() });
});

// ── Metrics ───────────────────────────────────────────────
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// ── Internal Auth (skip webhooks) ─────────────────────────
const WEBHOOK_PATHS = new Set([
  '/webhook/incomplete',
  '/payments/webhook/incomplete',
  '/api/payments/webhook/incomplete',
  '/payments/resolve-incomplete',
  '/api/payments/resolve-incomplete',
]);

app.use((req, _res, next) => {
  if (WEBHOOK_PATHS.has(req.path)) return next();
  return validateInternalKey(req, _res, next);
});

// ── Routes ────────────────────────────────────────────────
app.use('/payments',     paymentRoutes);
app.use('/api/payments', paymentRoutes);

// ── 404 ───────────────────────────────────────────────────
app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

// ── Error Handler ─────────────────────────────────────────
app.use(errorMiddleware);

export default app;
