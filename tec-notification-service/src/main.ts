import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { NotificationService } from './modules/notification/notification.service';
import { startNotificationConsumers } from './modules/notification/notification.consumer';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      initialScope: { tags: { service: 'notification-service' } },
    });
    console.log('[Sentry] Initialised for notification-service');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5006;
  await app.listen(PORT, '0.0.0.0');

  console.log(`🔔 Notification Service running on port ${PORT}`);

  // ✅ Start consumers
  if (process.env.REDIS_URL) {
    const notificationService = app.get(NotificationService);
    await startNotificationConsumers(notificationService);
    console.log('✅ Notification Consumers started');
  } else {
    console.warn('⚠️ REDIS_URL not set — Consumers disabled');
  }
}

bootstrap();
