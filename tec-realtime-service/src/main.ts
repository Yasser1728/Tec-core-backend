import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { RealtimeGateway } from './gateway/realtime.gateway';
import { startRealtimeConsumers } from './redis/redis.consumer';
import * as Sentry from '@sentry/node';

async function bootstrap() {
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      initialScope: { tags: { service: 'realtime-service' } },
    });
    console.log('[Sentry] Initialised for realtime-service');
  }

  // ✅ Express explicitly
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.enableCors({
    origin: '*',
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5010;
  await app.listen(PORT);

  console.log(`⚡ Realtime Service running on port ${PORT}`);

  if (process.env.REDIS_URL) {
    const gateway = app.get(RealtimeGateway);
    await startRealtimeConsumers(gateway);
  } else {
    console.warn('⚠️ REDIS_URL not set — Consumers disabled');
  }
}

bootstrap();
