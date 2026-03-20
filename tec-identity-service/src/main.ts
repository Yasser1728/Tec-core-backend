import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { IdentityService } from './modules/identity/identity.service';
import { startUserCreatedConsumer } from './modules/identity/user-created.consumer';
import * as Sentry from '@sentry/node';

async function bootstrap() {
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

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    credentials: true,
  });

  const PORT = process.env.PORT ?? 5005;
  await app.listen(PORT, '0.0.0.0');

  console.log(`🪪 Identity Service running on port ${PORT}`);

  // ✅ Static import بدل dynamic
  if (process.env.REDIS_URL) {
    const identityService = app.get(IdentityService);
    startUserCreatedConsumer(identityService).catch((err: Error) => {
      console.error('[UserCreatedConsumer] Fatal:', err.message);
    });
    console.log('✅ UserCreated Consumer started');
  } else {
    console.warn('⚠️ REDIS_URL not set — UserCreated Consumer disabled');
  }
}

bootstrap();
