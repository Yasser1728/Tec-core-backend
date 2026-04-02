import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from '@fastify/helmet';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production' && !process.env.INTERNAL_SECRET) {
    console.error('FATAL: INTERNAL_SECRET must be configured in production');
    process.exit(1);
  }

  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: true,
      bodyLimit: 1048576 * 5,
    })
  );

  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean);
  app.enableCors({
    origin:         allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : false,
    methods:        'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials:    true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Internal-Key',
  });

  await app.register(helmet as any, { contentSecurityPolicy: false });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:           true,
      forbidNonWhitelisted: true,
      transform:           true,
      errorHttpStatusCode: 422,
    }),
  );

  // ✅ api فقط — Controller prefix هو assets
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('TEC Asset Service')
    .setDescription('The Sovereign Asset Ledger for the TEC Ecosystem')
    .setVersion('1.0')
    .addTag('Assets')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Internal-Key', in: 'header' }, 'Internal-Key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/assets/docs', app, document);

  const port = process.env.PORT || 5004;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Asset Service is running on: http://0.0.0.0:${port}/api/assets`);
  logger.log(`📚 Documentation: http://0.0.0.0:${port}/api/assets/docs`);
}

bootstrap();
