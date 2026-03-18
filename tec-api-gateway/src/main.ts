// tec-api-gateway/src/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ProxyService } from './modules/proxy/proxy.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  // ✅ مفيش setGlobalPrefix هنا — عشان الـ proxy middleware يشتغل على /api/*

  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-secret'],
  });

  // ✅ Register الـ proxy middleware على الـ express instance
  const httpAdapter = app.getHttpAdapter();
  const expressApp = httpAdapter.getInstance();
  const proxyService = app.get(ProxyService);
  proxyService.registerProxies(expressApp);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 TEC Gateway running on port ${port}`);
}

bootstrap();
