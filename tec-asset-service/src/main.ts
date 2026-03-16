import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from '@fastify/helmet';

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
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || '*';
  app.enableCors({
    origin: allowedOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
    allowedHeaders: 'Content-Type, Accept, Authorization, X-Internal-Key',
  });

  // 3. Security: Helmet for XSS and Clickjacking protection
  // Using "as any" to resolve Fastify/NestJS type conflicts during build
  await app.register(helmet as any, {
    contentSecurityPolicy: false, 
  });

  // 4. Global Validation Pipe: Strict Mode for Data Integrity
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,               
      forbidNonWhitelisted: true,    
      transform: true,               
      errorHttpStatusCode: 422,      
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
  
  // Important: Use '0.0.0.0' so the container is accessible externally
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 Asset Service is running on: http://0.0.0.0:${port}/api/assets`);
  logger.log(`📚 Documentation: http://0.0.0.0:${port}/api/assets/docs`);
}

bootstrap();
