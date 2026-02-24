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
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
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

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('API Gateway Error', { message: err.message, stack: err.stack });
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
