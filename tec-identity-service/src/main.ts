import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  // ✅ Sentry
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      initialScope: {
        tags: { service: 'identity-service' },
      },
    });
    process.on('unhandledRejection', (reason) => {
      Sentry.captureException(reason);
    });
    process.on('uncaughtException', (error) => {
      Sentry.captureException(error);
      process.exit(1);
    });
    console.log('[Sentry] Initialised for identity-service');
  }

  // ✅ NestJS + Fastify
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5004;
  await app.listen(PORT, '0.0.0.0');

  console.log(`🪪 Identity Service running on port ${PORT}`);
}

bootstrap();
