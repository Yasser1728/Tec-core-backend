import { NestFactory }      from '@nestjs/core';
import { ValidationPipe }   from '@nestjs/common';
import helmet               from 'helmet';
import { AppModule }        from './app.module';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
    console.error('FATAL: INTERNAL_SECRET must be configured in production');
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  app.use(helmet());

  // ✅ C2 Fix — CORS allowlist بدل wildcard
  const allowedOrigins = [
    'https://tec-app.vercel.app',
    'https://api-gateway-production-6a68.up.railway.app',
    ...(process.env.CORS_ORIGIN?.split(',').map(s => s.trim()).filter(Boolean) ?? []),
  ];

  // ✅ في development — اسمح بـ localhost
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:3000');
    allowedOrigins.push('http://localhost:8080');
  }

  app.enableCors({
    origin: (origin, callback) => {
      // ✅ لو مفيش origin (inter-service calls) → اسمح
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
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
  console.log(`TEC Auth Service running on port ${port}`);
}

bootstrap();
