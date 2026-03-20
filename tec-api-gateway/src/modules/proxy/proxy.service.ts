import { Injectable, Logger } from '@nestjs/common';
import { Application, Request, Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger('ProxyService');

  private readonly services: Record<string, Options & { aliases?: string[] }> = {
    assets: {
      target: process.env.ASSET_SERVICE_URL || 'https://asset-service-production-54c4.up.railway.app',
      pathRewrite: { '^/api/assets': '/assets' },
    },
    auth: {
      target: process.env.AUTH_SERVICE_URL || 'https://auth-service-pi.up.railway.app',
      pathRewrite: { '^/api/auth': '' },
    },
    payment: {
      target: process.env.PAYMENT_SERVICE_URL || 'https://payment-service-production-90e5.up.railway.app',
      pathRewrite: { '^/api/payment': '/payments' },
      aliases: ['payments'],
    },
    wallet: {
      target: process.env.WALLET_SERVICE_URL || 'https://wallet-service-production-445d.up.railway.app',
      pathRewrite: { '^/api/wallet': '/wallets' },
      aliases: ['wallets'],
    },
    identity: {
      target: process.env.IDENTITY_SERVICE_URL || 'https://identity-service-production-fe57.up.railway.app',
      pathRewrite: { '^/api/identity': '/identity' },
    },
    notification: {
      target: process.env.NOTIFICATION_SERVICE_URL || 'https://notification-service-production-dc81.up.railway.app',
      pathRewrite: { '^/api/notification': '/notifications' },
    },
    storage: {
      target: process.env.STORAGE_SERVICE_URL || 'https://storage-sevice-production.up.railway.app',
      pathRewrite: { '^/api/storage': '/storage' },
    },
    // ✅ KYC Service
    kyc: {
      target: process.env.KYC_SERVICE_URL || 'https://kyc-service-production-ba73.up.railway.app',
      pathRewrite: { '^/api/kyc': '/kyc' },
    },
    fundx: {
      target: process.env.FUNDX_SERVICE_URL || 'https://fundx-service.up.railway.app',
      pathRewrite: { '^/api/fundx': '' },
    },
    nexus: {
      target: process.env.NEXUS_SERVICE_URL || 'https://nexus-service.up.railway.app',
      pathRewrite: { '^/api/nexus': '' },
    },
    analytics: {
      target: process.env.ANALYTICS_SERVICE_URL || 'https://analytics-service.up.railway.app',
      pathRewrite: { '^/api/analytics': '' },
    },
    domains: {
      target: process.env.DOMAIN_SERVICE_URL || 'https://domain-service.up.railway.app',
      pathRewrite: { '^/api/domains': '' },
    },
    commerce: {
      target: process.env.COMMERCE_SERVICE_URL || 'https://commerce-service.up.railway.app',
      pathRewrite: { '^/api/commerce': '' },
    },
    assets2: {
      target: process.env.ASSETS2_SERVICE_URL || 'https://assets2-service.up.railway.app',
      pathRewrite: { '^/api/assets2': '' },
    },
    assets3: {
      target: process.env.ASSETS3_SERVICE_URL || 'https://assets3-service.up.railway.app',
      pathRewrite: { '^/api/assets3': '' },
    },
    tokens: {
      target: process.env.TOKEN_SERVICE_URL || 'https://token-service.up.railway.app',
      pathRewrite: { '^/api/tokens': '' },
    },
  };

  public registerProxies(app: Application) {
    Object.entries(this.services).forEach(([key, options]) => {
      const { aliases, ...proxyOptions } = options;

      this.registerSingleProxy(app, key, proxyOptions);

      if (aliases && aliases.length > 0) {
        aliases.forEach((alias) => {
          const originalTarget = (proxyOptions.pathRewrite as Record<string, string>);
          const originalValue = Object.values(originalTarget)[0];

          const aliasOptions: Options = {
            ...proxyOptions,
            pathRewrite: { [`^/api/${alias}`]: originalValue },
          };
          this.registerSingleProxy(app, alias, aliasOptions);
        });
      }
    });

    this.logger.log(`🚀 TEC Gateway is Live on port ${process.env.PORT || 3000}`);
    this.logger.log(`🔧 All ${this.getTotalRoutes()} microservice routes have been mapped successfully`);
  }

  private registerSingleProxy(app: Application, routeKey: string, options: Options) {
    const target = options.target as string;

    app.use(
      `/api/${routeKey}`,
      createProxyMiddleware({
        ...options,
        changeOrigin: true,
        secure: true,
        timeout: 30000,
        proxyTimeout: 30000,
        onProxyReq: (proxyReq, req: Request) => {
          const auth = req.headers['authorization'];
          if (auth) {
            proxyReq.setHeader('Authorization', auth);
          }
          proxyReq.setHeader(
            'x-internal-key',
            process.env.INTERNAL_SECRET || '',
          );
          this.logger.debug(
            `[${routeKey}] ${req.method} ${req.url} → ${target}`,
          );
        },
        onProxyRes: (_proxyRes, _req: Request) => {
          this.logger.log(
            `[${routeKey} Proxy] Response received with status: ${_proxyRes.statusCode}`,
          );
        },
        onError: (err, _req: Request, res: Response) => {
          this.logger.error(`[${routeKey} Proxy Error] ${err.message}`);
          if (!res.headersSent) {
            res.status(502).json({
              error: `${routeKey} service unavailable`,
              message: 'Bad Gateway — upstream service did not respond',
            });
          }
        },
      }),
    );

    this.logger.log(`[HPM] Mapped /api/${routeKey} -> ${target}`);
  }

  private getTotalRoutes(): number {
    return Object.entries(this.services).reduce((count, [, options]) => {
      return count + 1 + ((options as any).aliases?.length || 0);
    }, 0);
  }
}
