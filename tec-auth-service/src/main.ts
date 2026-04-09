import { NestFactory }      from '@nestjs/core';
import { ValidationPipe }   from '@nestjs/common';
import helmet               from 'helmet';
import pino                 from 'pino';
import { AppModule }        from './app.module';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base:  { service: 'auth-service' },
});

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
    logger.fatal('FATAL: INTERNAL_SECRET must be configured in production');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  const allowedOrigins = [
    'https://tec-app.vercel.app',
    'https://api-gateway-production-6a68.up.railway.app',
    ...(process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) ?? []),
  ];

  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('http://localhost:8080');
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS: origin ${origin} not allowed`), false);
    },
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-request-id'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 5001;
  await app.listen(port);
  logger.info({ port }, 'TEC Auth Service running');
}

bootstrap();
