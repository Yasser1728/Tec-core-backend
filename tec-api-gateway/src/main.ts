import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ProxyService } from './modules/proxy/proxy.service';

const SERVICE_VERSION  = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.enableCors({
    origin:         process.env.CORS_ORIGIN?.split(',') || '*',
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-secret', 'x-internal-key'],
  });

  const httpAdapter = app.getHttpAdapter();
  const expressApp  = httpAdapter.getInstance();

  // ── Register proxy routes ────────────────────────────────
  const proxyService = app.get(ProxyService);
  proxyService.registerProxies(expressApp);

  // ── Health endpoint ──────────────────────────────────────
  expressApp.get('/health', async (_req: any, res: any) => {
    const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
    res.json({
      status:    'ok',
      service:   'api-gateway',
      timestamp: new Date().toISOString(),
      uptime,
      version:   SERVICE_VERSION,
    });
  });

  // ── Ready endpoint ───────────────────────────────────────
  expressApp.get('/ready', (_req: any, res: any) => {
    res.json({ status: 'ready', service: 'api-gateway' });
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 TEC Gateway running on port ${port}`);
}

bootstrap();
