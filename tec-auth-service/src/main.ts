// src/main.ts

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { logger } from './infra/logger';
import { env } from './config/env';

async function bootstrap() {
  // إنشاء تطبيق Nest مع Fastify لأداء أفضل
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // نستخدم الـ Pino Logger المخصص
      trustProxy: true,
    }),
  );

  // تفعيل CORS ديناميكياً حسب environment
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global Validation Pipe لجميع الـ DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // إزالة الخصائص غير المعروفة
      forbidNonWhitelisted: true, // يرمي خطأ لو فيه خصائص إضافية
      transform: true, // يحول payloads تلقائياً إلى كائنات DTO
    }),
  );

  // تفعيل API Versioning على مستوى URI
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // إعداد global prefix ليكون متوافق مع Gateway
  app.setGlobalPrefix('api');

  // تفعيل graceful shutdown hooks
  app.enableShutdownHooks();

  // استخدام port من env مع fallback
  const PORT = env.PORT || 5001;

  await app.listen(PORT, '0.0.0.0');

  logger.info(`🚀 TEC Auth Service is running at http://localhost:${PORT}/api/v1/auth`);
}

bootstrap();
