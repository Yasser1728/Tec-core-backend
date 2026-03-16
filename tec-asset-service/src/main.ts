import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { fastifyHelmet } from '@fastify/helmet';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  
  // 1. Initialize High-Performance Fastify Adapter
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ 
      logger: true,
      bodyLimit: 1048576 * 5 // 5MB limit for rich asset metadata
    })
  );

  // 2. Security: Cross-Origin Resource Sharing (CORS)
  // Essential for the 24 sectors to communicate with the core
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || '*';
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Internal-Key',
  });

  // 3. Security: Helmet for XSS and Clickjacking protection
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // Disabled to allow Swagger UI in development
  });

  // 4. Global Validation Pipe: Strict Mode for Data Integrity
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,               // Strip non-decorated properties
      forbidNonWhitelisted: true,    // Throw error if extra fields are present
      transform: true,               // Automatically transform payloads to DTO types
      errorHttpStatusCode: 422,      // Standard for Validation Errors
    }),
  );

  // 5. API Versioning & Prefixing
  app.setGlobalPrefix('api/assets');

  // 6. API Documentation: Swagger Open-API setup
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

  // 7. Network & Port Binding for Cloud Environments (Railway)
  const port = process.env.PORT || 5004;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Asset Service is running on: http://0.0.0.0:${port}/api/assets`);
  logger.log(`🔐 CORS enabled for: ${allowedOrigins}`);
  logger.log(`📚 Documentation: http://localhost:${port}/api/assets/docs`);
}

bootstrap();
