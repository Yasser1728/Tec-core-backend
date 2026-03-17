import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import helmet from 'helmet';
import morgan = require('morgan'); // Compatible with TypeScript
import { ProxyService } from './modules/proxy/proxy.service';

async function bootstrap() {
  const logger = new Logger('TEC-Gateway');

  // Create NestJS application
  const app = await NestFactory.create(AppModule);

  // 1. Security headers
  app.use(helmet());

  // 2. Enable CORS for all 24 apps
  app.enableCors();

  // 3. Request logging for monitoring traffic
  app.use(morgan('dev'));

  // 4. Register ProxyService and map all 14 microservices
  const proxyService = app.get(ProxyService);

  // Pass the underlying Express instance to ProxyService
  proxyService.registerProxies(app.getHttpAdapter().getInstance());

  // 5. Listen on defined port
  const port = process.env.PORT || 5000;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 TEC Gateway is Live on port ${port}`);
  logger.log(`🛠️ All 14 microservices have been mapped successfully`);
}

bootstrap();
