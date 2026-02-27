import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import proxyRoutes from './routes/proxy';
import { rateLimiter } from './middleware/rateLimiter';
import { httpLogger } from './middleware/logger';
import { requestIdMiddleware } from './middleware/request-id';
import { metricsMiddleware } from './middleware/metrics';
import { register } from './infra/metrics';
import { initSentry, Sentry, isSentryEnabled } from './infra/observability';
import { logger } from './infra/logger';
import { env } from './config/env';

dotenv.config();

// Initialise Sentry before anything else so errors during startup are captured.
initSentry();

const app: Application = express();
const PORT = env.PORT;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

const AUTH_SERVICE_URL = env.AUTH_SERVICE_URL;
const WALLET_SERVICE_URL = env.WALLET_SERVICE_URL;
const PAYMENT_SERVICE_URL = env.PAYMENT_SERVICE_URL;

interface ServiceStatus {
  status: 'ok' | 'error';
  version?: string;
  message?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  uptime: number;
  version: string;
  services: Record<string, ServiceStatus>;
}

app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
// ALLOWED_ORIGINS (comma-separated) is the primary env var.  Each entry may
// be an exact origin string or a pattern ending with "*.vercel.app" which is
// converted to a RegExp to match Vercel preview deployments.
// Defaults to false (deny all cross-origin requests) when the variable is unset.
const buildCorsOrigin = (): cors.CorsOptions['origin'] => {
  const raw = env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (!raw) return false;

  const entries = raw.split(',').map((o) => o.trim()).filter(Boolean);
  if (entries.length === 0) return false;

  // Convert wildcard patterns like "https://*.vercel.app" to RegExp.
  const matchers: Array<string | RegExp> = entries.map((entry) => {
    if (entry.includes('*')) {
      const escaped = entry.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '[^.]+');
      return new RegExp(`^${escaped}$`);
    }
    return entry;
  });

  return (origin, callback) => {
    // Allow same-origin / non-browser (no Origin header) requests.
    if (!origin) return callback(null, true);
    const allowed = matchers.some((m) =>
      typeof m === 'string' ? m === origin : m.test(origin)
    );
    if (allowed) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  };
};

app.use(cors({
  origin: buildCorsOrigin(),
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
}));

// ─── Observability middleware (before routes) ─────────────────────────────────
app.use(requestIdMiddleware);
app.use(httpLogger);
app.use(metricsMiddleware);
app.use(rateLimiter);

app.get('/health', async (_req, res) => {
  try {
    const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);

    const healthResponse: HealthResponse = {
      status: 'ok',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime,
      version: SERVICE_VERSION,
      services: {},
    };

    const services = [
      { name: 'auth-service', url: `${AUTH_SERVICE_URL}/health` },
      { name: 'wallet-service', url: `${WALLET_SERVICE_URL}/health` },
      { name: 'payment-service', url: `${PAYMENT_SERVICE_URL}/health` },
    ];

    await Promise.all(
      services.map(async (service) => {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 2000);

          const response = await fetch(service.url, {
            signal: controller.signal,
          });
          clearTimeout(timeoutId);

          if (response.ok) {
            const data: unknown = await response.json();
            const serviceData = data as { version?: string };
            healthResponse.services[service.name] = {
              status: 'ok',
              version: serviceData.version || 'unknown',
            };
          } else {
            healthResponse.services[service.name] = {
              status: 'error',
              message: `HTTP ${response.status}`,
            };
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Connection failed';
          healthResponse.services[service.name] = {
            status: 'error',
            message: errorMessage,
          };
        }
      })
    );

    const anyServiceDown = Object.values(healthResponse.services).some(
      (s) => s.status === 'error'
    );
    if (anyServiceDown) {
      healthResponse.status = 'degraded';
    }

    res.json(healthResponse);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Health check failed';
    res.status(503).json({
      status: 'error',
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      message: errorMessage,
    });
  }
});

// Readiness probe — returns 200 once the process is ready to serve traffic.
app.get('/ready', (_req, res) => {
  res.json({ status: 'ready', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// Prometheus metrics endpoint.
app.get('/metrics', async (_req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.use('/api', proxyRoutes);

app.use('*', (_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'Endpoint not found',
    },
  });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (isSentryEnabled()) {
    Sentry.captureException(err);
  }
  logger.error('API Gateway Error', {
    message: err.message,
    stack: err.stack,
    requestId: req.headers['x-request-id'],
  });
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

app.listen(PORT, () => {
  logger.info(`🚀 API Gateway running on port ${PORT}`);
  logger.info(`📡 Auth Service: ${AUTH_SERVICE_URL}`);
  logger.info(`💰 Wallet Service: ${WALLET_SERVICE_URL}`);
  logger.info(`💳 Payment Service: ${PAYMENT_SERVICE_URL}`);
});

export default app;
