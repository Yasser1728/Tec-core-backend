import express, { Application } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import proxyRoutes from './routes/proxy';
import { rateLimiter } from './middleware/rateLimiter';
import { logger } from './middleware/logger';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 3000;
const SERVICE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// Downstream service URLs
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:5001';
const WALLET_SERVICE_URL = process.env.WALLET_SERVICE_URL || 'http://localhost:5002';
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:5003';

// Types for health check
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

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
}));

// Logging
app.use(morgan('combined'));

// Rate limiting
app.use(rateLimiter);

// Health check with downstream service status
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

    // Check downstream services
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

    // Overall status is 'degraded' if any service is down
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

// API routes - proxy to microservices
app.use('/api', logger, proxyRoutes);

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
  console.error('API Gateway Error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
});

app.listen(PORT, () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log(`📡 Auth Service: ${AUTH_SERVICE_URL}`);
  console.log(`💰 Wallet Service: ${WALLET_SERVICE_URL}`);
  console.log(`💳 Payment Service: ${PAYMENT_SERVICE_URL}`);
});

export default app;