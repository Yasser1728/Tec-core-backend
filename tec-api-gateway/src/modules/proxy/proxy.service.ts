import { Injectable, Logger } from '@nestjs/common';
import { Application, Request, Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger('ProxyService');

  // Define all 14 microservices dynamically
  private readonly services: Record<string, Options> = {
    assets: {
      target: 'https://asset-service-production-54c4.up.railway.app',
      pathRewrite: { '^/api/assets': '' },
    },
    auth: {
      target: 'https://auth-service-pi.up.railway.app',
      pathRewrite: { '^/api/auth': '' },
    },
    payment: {
      target: 'https://payment-service-production-90e5.up.railway.app',
      pathRewrite: { '^/api/payment': '' },
    },
    wallet: {
      target: 'https://wallet-service-production-445d.up.railway.app',
      pathRewrite: { '^/api/wallet': '' },
    },
    fundx: {
      target: 'https://fundx-service.up.railway.app',
      pathRewrite: { '^/api/fundx': '' },
    },
    nexus: {
      target: 'https://nexus-service.up.railway.app',
      pathRewrite: { '^/api/nexus': '' },
    },
    identity: {
      target: 'https://identity-service.up.railway.app',
      pathRewrite: { '^/api/identity': '' },
    },
    analytics: {
      target: 'https://analytics-service.up.railway.app',
      pathRewrite: { '^/api/analytics': '' },
    },
    notification: {
      target: 'https://notification-service.up.railway.app',
      pathRewrite: { '^/api/notification': '' },
    },
    domains: {
      target: 'https://domain-service.up.railway.app',
      pathRewrite: { '^/api/domains': '' },
    },
    commerce: {
      target: 'https://commerce-service.up.railway.app',
      pathRewrite: { '^/api/commerce': '' },
    },
    assets2: {
      target: 'https://assets2-service.up.railway.app',
      pathRewrite: { '^/api/assets2': '' },
    },
    assets3: {
      target: 'https://assets3-service.up.railway.app',
      pathRewrite: { '^/api/assets3': '' },
    },
    tokens: {
      target: 'https://token-service.up.railway.app',
      pathRewrite: { '^/api/tokens': '' },
    },
  };

  public registerProxies(app: Application) {
    Object.entries(this.services).forEach(([key, options]) => {
      app.use(
        `/api/${key}`,
        createProxyMiddleware({
          ...options,
          changeOrigin: true,
          onProxyRes: (_proxyRes, _req, _res) => {
            this.logger.log(`[${key} Proxy] Response received with status: ${_proxyRes.statusCode}`);
          },
          onError: (err, _req: Request, res: Response) => {
            this.logger.error(`[${key} Proxy Error] ${err.message}`);
            res.status(500).json({ error: `${key} Service unavailable` });
          },
        }),
      );
      this.logger.log(`Mapped /api/${key} -> ${options.target}`);
    });
  }
}
