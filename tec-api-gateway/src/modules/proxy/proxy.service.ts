import { Injectable, Logger } from '@nestjs/common';
import { Application, Request, Response } from 'express';
import { createProxyMiddleware, Options } from 'http-proxy-middleware';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger('ProxyService');

  private readonly services: Record<string, Options & { aliases?: string[] }> = {
    assets: {
      target:      process.env.ASSET_SERVICE_URL || 'https://asset-service-production-54c4.up.railway.app',
      pathRewrite: { '^/api/v1/assets': '/api/assets', '^/api/assets': '/api/assets' },
    },
    auth: {
      target:      process.env.AUTH_SERVICE_URL || 'https://auth-service-pi.up.railway.app',
      pathRewrite: { '^/api/v1/auth': '', '^/api/auth': '' },
    },
    payment: {
      target:      process.env.PAYMENT_SERVICE_URL || 'https://payment-service-production-90e5.up.railway.app',
      pathRewrite: { '^/api/v1/payment': '/payments', '^/api/payment': '/payments' },
      aliases:     ['payments'],
    },
    wallet: {
      target:      process.env.WALLET_SERVICE_URL || 'https://wallet-service-production-445d.up.railway.app',
      pathRewrite: { '^/api/v1/wallet': '/wallets', '^/api/wallet': '/wallets' },
      aliases:     ['wallets'],
    },
    identity: {
      target:      process.env.IDENTITY_SERVICE_URL || 'https://identity-service-production-fe57.up.railway.app',
      pathRewrite: { '^/api/v1/identity': '/identity', '^/api/identity': '/identity' },
    },
    notification: {
      target:      process.env.NOTIFICATION_SERVICE_URL || 'https://notification-service-production-dc81.up.railway.app',
      pathRewrite: { '^/api/v1/notification': '/notifications', '^/api/notification': '/notifications' },
    },
    storage: {
      target:      process.env.STORAGE_SERVICE_URL || 'https://storage-sevice-production.up.railway.app',
      pathRewrite: { '^/api/v1/storage': '/storage', '^/api/storage': '/storage' },
    },
    kyc: {
      target:      process.env.KYC_SERVICE_URL || 'https://kyc-service-production-ba73.up.railway.app',
      pathRewrite: { '^/api/v1/kyc': '/kyc', '^/api/kyc': '/kyc' },
    },
    commerce: {
      target:      process.env.COMMERCE_SERVICE_URL || 'https://commerce-service-production.up.railway.app',
      pathRewrite: { '^/api/v1/commerce': '/commerce', '^/api/commerce': '/commerce' },
    },
    realtime: {
      target:      process.env.REALTIME_SERVICE_URL || 'https://realtime-service-production-9630.up.railway.app',
      pathRewrite: { '^/api/v1/realtime': '', '^/api/realtime': '' },
    },
    analytics: {
      target:      process.env.ANALYTICS_SERVICE_URL || 'https://analytics-service-production-c310.up.railway.app',
      pathRewrite: { '^/api/v1/analytics': '/analytics', '^/api/analytics': '/analytics' },
    },
    fundx: {
      target:      process.env.FUNDX_SERVICE_URL || 'https://fundx-service.up.railway.app',
      pathRewrite: { '^/api/v1/fundx': '', '^/api/fundx': '' },
    },
    nexus: {
      target:      process.env.NEXUS_SERVICE_URL || 'https://nexus-service.up.railway.app',
      pathRewrite: { '^/api/v1/nexus': '', '^/api/nexus': '' },
    },
    domains: {
      target:      process.env.DOMAIN_SERVICE_URL || 'https://domain-service.up.railway.app',
      pathRewrite: { '^/api/v1/domains': '', '^/api/domains': '' },
    },
    tokens: {
      target:      process.env.TOKEN_SERVICE_URL || 'https://token-service.up.railway.app',
      pathRewrite: { '^/api/v1/tokens': '', '^/api/tokens': '' },
    },
  };

  public registerProxies(app: Application) {
    Object.entries(this.services).forEach(([key, options]) => {
      const { aliases, ...proxyOptions } = options;

      // ── v1 routes (new) ──────────────────────────────
      this.registerSingleProxy(app, key, proxyOptions, true);

      // ── legacy routes (backward compat) ─────────────
      this.registerSingleProxy(app, key, proxyOptions, false);

      if (aliases && aliases.length > 0) {
        aliases.forEach((alias) => {
          const originalValue = Object.values(
            proxyOptions.pathRewrite as Record<string, string>
          )[0];
          const aliasOptions: Options = {
            ...proxyOptions,
            pathRewrite: {
              [`^/api/v1/${alias}`]: originalValue,
              [`^/api/${alias}`]:    originalValue,
            },
          };
          this.registerSingleProxy(app, alias, aliasOptions, true);
          this.registerSingleProxy(app, alias, aliasOptions, false);
        });
      }
    });

    this.logger.log(`✅ TEC Gateway v1 routes registered`);
    this.logger.log(`🔄 Legacy /api/* routes preserved for backward compatibility`);
    this.logger.log(`🚀 TEC Gateway is Live on port ${process.env.PORT || 3000}`);
    this.logger.log(`🔧 All ${this.getTotalRoutes()} microservice routes mapped`);
  }

  private registerSingleProxy(
    app:       Application,
    routeKey:  string,
    options:   Options,
    versioned: boolean,
  ) {
    const target    = options.target as string;
    const routePath = versioned
      ? `/api/v1/${routeKey}`
      : `/api/${routeKey}`;

    app.use(
      routePath,
      createProxyMiddleware({
        ...options,
        changeOrigin: true,
        secure:       true,
        timeout:      30000,
        proxyTimeout: 30000,
        onProxyReq: (proxyReq, req: Request) => {
          const auth   = req.headers['authorization'];
          const secret = process.env.INTERNAL_SECRET || '';

          if (auth)   proxyReq.setHeader('Authorization', auth);
          if (secret) proxyReq.setHeader('x-internal-key', secret);

          // ── API version header للـ downstream services
          proxyReq.setHeader('x-api-version', versioned ? 'v1' : 'legacy');

          const requestId = req.headers['x-request-id'];
          if (requestId) proxyReq.setHeader('x-request-id', String(requestId));

          this.logger.debug(
            `[${routeKey}] ${req.method} ${req.url} → ${target} (${versioned ? 'v1' : 'legacy'})`
          );
        },
        onProxyRes: (_proxyRes, _req: Request) => {
          this.logger.log(
            `[${routeKey}] Response: ${_proxyRes.statusCode}`
          );
        },
        onError: (err, _req: Request, res: Response) => {
          this.logger.error(`[${routeKey} Error] ${err.message}`);
          if (!res.headersSent) {
            res.status(502).json({
              success: false,
              error: {
                code:    'BAD_GATEWAY',
                message: `${routeKey} service unavailable`,
              },
            });
          }
        },
      }),
    );

    this.logger.log(`[HPM] Mapped ${routePath} → ${target}`);
  }

  private getTotalRoutes(): number {
    return Object.entries(this.services).reduce((count, [, options]) => {
      const aliases = (options as { aliases?: string[] }).aliases?.length || 0;
      return count + (1 + aliases) * 2; // v1 + legacy لكل route
    }, 0);
  }
}
