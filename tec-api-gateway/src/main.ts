import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import helmet from 'helmet';
import morgan = require('morgan');
import { ProxyService } from './modules/proxy/proxy.service';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('TEC-Gateway');
  const app = await NestFactory.create(AppModule);

  // Security headers
  app.use(helmet());

  // Enable CORS
  app.enableCors();

  // Request logging
  app.use(morgan('dev'));

  // Register all proxies for 14 microservices
  const proxyService = app.get(ProxyService);
  proxyService.registerProxies(app);

  const port = process.env.PORT || 5000;
  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 TEC Gateway is Live on port ${port}`);
}

bootstrap();
