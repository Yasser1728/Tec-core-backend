import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { AppModule } from './app.module';
import { logger } from './infra/logger';
import { env } from './config/env';

async function bootstrap() {
  // Create Nest app with Fastify for better performance
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // Using custom Pino logger
      trustProxy: true,
    }),
  );

  // Enable CORS dynamically based on environment
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global Validation Pipe for DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // throw error if extra properties found
      transform: true, // auto-transform payloads to DTO classes
    }),
  );

  // Enable API Versioning
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Set global API prefix to match Gateway
  app.setGlobalPrefix('api');

  // Optional: enable graceful shutdown hooks
  app.enableShutdownHooks();

  const PORT = env.PORT || 5001;

  await app.listen(PORT, '0.0.0.0');

  logger.info(`🚀 TEC Auth Service is running at http://localhost:${PORT}/api/v1/auth`);
}

bootstrap();
