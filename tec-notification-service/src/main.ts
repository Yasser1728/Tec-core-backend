import 'reflect-metadata';
import { NestFactory }           from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule }             from './app.module';
import { NotificationService }   from './modules/notification/notification.service';
import { startNotificationConsumers } from './modules/notification/notification.consumer';
import * as Sentry               from '@sentry/node';
import pino                      from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base:  { service: 'notification-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
    logger.error('FATAL: INTERNAL_SECRET must be configured in production');
    process.exit(1);
  }

  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn:              process.env.SENTRY_DSN,
      environment:      process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      initialScope:     { tags: { service: 'notification-service' } },
    });
    logger.info('[Sentry] Initialised for notification-service');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map(o => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin:      allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5006;
  await app.listen(PORT, '0.0.0.0');

  logger.info(`🔔 Notification Service running on port ${PORT}`);

  if (process.env.REDIS_URL) {
    const notificationService = app.get(NotificationService);
    await startNotificationConsumers(notificationService);
    logger.info('✅ Notification Consumers started');
  } else {
    logger.warn('⚠️ REDIS_URL not set — Consumers disabled');
  }
}

bootstrap();
