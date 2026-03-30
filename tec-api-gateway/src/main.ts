import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ProxyService } from './modules/proxy/proxy.service';
import { Request, Response, NextFunction } from 'express';

const SERVICE_VERSION  = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin:         process.env.CORS_ORIGIN?.split(',') || '*',
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-request-id'],
  });

  const httpAdapter = app.getHttpAdapter();
  const expressApp  = httpAdapter.getInstance();

  // ── API Version header على كل response ──────────────────
  expressApp.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-api-version', 'v1');
    res.setHeader('x-powered-by', 'TEC Gateway');
    next();
  });

  // ── Register proxy routes (v1 + legacy) ─────────────────
  const proxyService = app.get(ProxyService);
  proxyService.registerProxies(expressApp);

  // ── Health endpoint ──────────────────────────────────────
  expressApp.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
    res.json({
      status:     'ok',
      service:    'api-gateway',
      version:    SERVICE_VERSION,
      apiVersion: 'v1',
      timestamp:  new Date().toISOString(),
      uptime,
    });
  });

  // ── Ready endpoint ───────────────────────────────────────
  expressApp.get('/ready', (_req: Request, res: Response) => {
    res.json({
      status:     'ready',
      service:    'api-gateway',
      apiVersion: 'v1',
    });
  });

  // ── 404 handler ──────────────────────────────────────────
  expressApp.use('*', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: {
        code:    'NOT_FOUND',
        message: 'Endpoint not found',
      },
    });
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 TEC Gateway v1 running on port ${port}`);
  logger.log(`📡 New routes:    /api/v1/{service}`);
  logger.log(`🔄 Legacy routes: /api/{service} (backward compat)`);
}

bootstrap();
