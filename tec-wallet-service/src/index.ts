import dotenv from 'dotenv';
dotenv.config();

if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
  console.error('FATAL: INTERNAL_SECRET must be configured in production');
  process.exit(1);
}

import express, { Application } from 'express';
import cors                      from 'cors';
import helmet                    from 'helmet';
import walletRoutes              from './routes/wallet.routes';
import { logger }                from './utils/logger';
import { validateInternalKey }   from './middleware/internal-auth';
import { requestIdMiddleware }   from './middleware/request-id';
import { metricsMiddleware }     from './middleware/metrics';
import { register }              from './infra/metrics';
import { initSentry }            from './infra/observability';
import { env }                   from './config/env';
import { startWalletEventConsumer } from './wallet-event-consumer';

initSentry();

const app: Application = express();
const PORT             = env.PORT;
const SERVICE_VERSION  = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'"],
        imgSrc:     ["'self'"],
        connectSrc: ["'self'"],
        frameSrc:   ["'none'"],
        objectSrc:  ["'none'"],
      },
    },
    frameguard: { action: 'deny' },
    noSniff:    true,
    xssFilter:  true,
    hsts:       { maxAge: 31536000, includeSubDomains: true },
  })
);

const parseCorsOrigins = (): string[] | string | false => {
  const raw = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw) return false;
  if (raw === '*') return '*';
  const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
  return origins.length > 0 ? origins : false;
};

app.use(
  cors({
    origin:         parseCorsOrigins(),
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(requestIdMiddleware);
app.use(metricsMiddleware);

// ── Public endpoints (no auth) ────────────────────────────
app.get('/health', (_req, res) => {
  const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
  res.json({
    status:    'ok',
    service:   'wallet-service',
    timestamp: new Date().toISOString(),
    uptime,
    version:   SERVICE_VERSION,
  });
});

app.get('/ready', (_req, res) => {
  res.json({
    status:    'ready',
    service:   'wallet-service',
    timestamp: new Date().toISOString(),
  });
});

// ✅ P2-12: validateInternalKey قبل /metrics و wallet routes
app.use(validateInternalKey);

app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/wallets',     walletRoutes);
app.use('/api/wallets', walletRoutes);

app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error:   { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

app.use((
  err:   Error,
  _req:  express.Request,
  res:   express.Response,
  _next: express.NextFunction,
) => {
  logger.error('Wallet Service Error', {
    message: err.message,
    stack:   err.stack,
  });
  res.status(500).json({
    success: false,
    error:   { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
});

// ─── Start Server ─────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`💰 Wallet Service running on port ${PORT}`);
  logger.info(`REDIS_URL configured: ${!!env.REDIS_URL}`);

  if (env.REDIS_URL) {
    startWalletEventConsumer().catch((err) => {
      logger.error('❌ Wallet Event Consumer failed to start', {
        error: (err as Error).message,
      });
    });
    logger.info('🔴 Redis Event Consumer started — listening for payment.completed');
  } else {
    logger.warn('⚠️ REDIS_URL not set — Event Consumer disabled');
  }
});

export default app;
