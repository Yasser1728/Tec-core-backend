import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AnalyticsService } from './modules/analytics/analytics.service';
import { startAnalyticsConsumers } from './modules/analytics/analytics.consumer';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      initialScope: { tags: { service: 'analytics-service' } },
    });
    console.log('[Sentry] Initialised for analytics-service');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5011;
  await app.listen(PORT, '0.0.0.0');

  console.log(`📊 Analytics Service running on port ${PORT}`);

  if (process.env.REDIS_URL) {
    const analyticsService = app.get(AnalyticsService);
    await startAnalyticsConsumers(analyticsService);
  } else {
    console.warn('⚠️ REDIS_URL not set — Consumers disabled');
  }
}

bootstrap();
