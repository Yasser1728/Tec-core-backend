import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { createProxyMiddleware } from 'http-proxy-middleware';
import helmet from 'helmet';
import * as morgan from 'morgan';
import rateLimit from 'express-rate-limit';

async function bootstrap() {
  const logger = new Logger('TEC-Gateway');
  const app = await NestFactory.create(AppModule);

  // Security
  app.use(helmet());

  // CORS
  app.enableCors();

  // Logging
  app.use(morgan('dev'));

  // Rate Limiter
  app.use(
    rateLimit({
      windowMs: 60 * 1000, // دقيقة واحدة
      max: 100, // أقصى 100 طلب/دقيقة لكل IP
    }),
  );

  // =========================
  // Asset Service Proxy
  // =========================
  app.use(
    '/api/assets',
    createProxyMiddleware({
      target: 'https://asset-service-production-54c4.up.railway.app',
      changeOrigin: true,
      pathRewrite: { '^/api/assets': '' },
      onProxyRes(proxyRes, req, res) {
        logger.log(`[Asset Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
      },
      onError(err, req, res) {
        logger.error(`[Asset Proxy Error] ${err.message}`);
        res.status(500).json({ error: 'Asset Service unavailable' });
      },
    }),
  );

  // =========================
  // Auth Service Proxy
  // =========================
  app.use(
    '/api/auth',
    createProxyMiddleware({
      target: 'https://auth-service-pi.up.railway.app',
      changeOrigin: true,
      pathRewrite: { '^/api/auth': '' },
      onProxyRes(proxyRes, req, res) {
        logger.log(`[Auth Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
      },
      onError(err, req, res) {
        logger.error(`[Auth Proxy Error] ${err.message}`);
        res.status(500).json({ error: 'Auth Service unavailable' });
      },
    }),
  );

  // =========================
  // Payment Service Proxy
  // =========================
  app.use(
    '/api/payment',
    createProxyMiddleware({
      target: 'https://payment-service-production-90e5.up.railway.app',
      changeOrigin: true,
      pathRewrite: { '^/api/payment': '' },
      onProxyRes(proxyRes, req, res) {
        logger.log(`[Payment Proxy] ${req.method} ${req.url} -> ${proxyRes.statusCode}`);
      },
      onError(err, req, res) {
        logger.error(`[Payment Proxy Error] ${err.message}`);
        res.status(500).json({ error: 'Payment Service unavailable' });
      },
    }),
  );

  const port = process.env.PORT || 5000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 TEC Gateway is Live on port ${port}`);
}

bootstrap();
