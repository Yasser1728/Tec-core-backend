import 'reflect-metadata';
import { NestFactory }            from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule }              from './app.module';
import { RealtimeGateway }        from './gateway/realtime.gateway';
import { startRealtimeConsumers } from './redis/redis.consumer';
import * as Sentry                from '@sentry/node';
import pino                       from 'pino';

const logger = pino({
  level:     process.env.LOG_LEVEL ?? 'info',
  base:      { service: 'realtime-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

async function bootstrap() {
  if (process.env.SENTRY_DSN && process.env.NODE_ENV === 'production') {
    Sentry.init({
      dsn:              process.env.SENTRY_DSN,
      environment:      process.env.NODE_ENV,
      tracesSampleRate: 0.1,
      initialScope:     { tags: { service: 'realtime-service' } },
    });
    logger.info('[Sentry] Initialised for realtime-service');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ?.split(',')
    .map(s => s.trim())
    .filter(Boolean) ?? ['https://tec-app.vercel.app'];

  app.enableCors({
    origin:      allowedOrigins,
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5010;
  await app.listen(PORT);

  logger.info(`⚡ Realtime Service running on port ${PORT}`);

  if (process.env.REDIS_URL) {
    const gateway = app.get(RealtimeGateway);
    await startRealtimeConsumers(gateway);
  } else {
    logger.warn('⚠️ REDIS_URL not set — Consumers disabled');
  }
}

bootstrap();
