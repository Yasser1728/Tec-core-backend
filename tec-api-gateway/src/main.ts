import { NestFactory }                  from '@nestjs/core';
import { AppModule }                    from './app.module';
import { Logger }                       from '@nestjs/common';
import { ProxyService }                 from './modules/proxy/proxy.service';
import { Request, Response, NextFunction } from 'express';
import swaggerUi                        from 'swagger-ui-express';
import swaggerJsdoc                     from 'swagger-jsdoc';
import { GlobalExceptionFilter } from './filters/global-exception.filter';
import { rateLimiter, authRateLimiter, paymentRateLimiter } from './middleware/rateLimiter';

const SERVICE_VERSION  = process.env.SERVICE_VERSION || '1.0.0';
const serviceStartTime = Date.now();

// ── Swagger Definition ────────────────────────────────────
const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title:       'TEC Ecosystem API',
      version:     SERVICE_VERSION,
      description: 'TEC — Web3 Super Platform on Pi Network. One identity. One wallet. 24 apps.',
      contact: {
        name:  'TEC Team',
        url:   'https://tec-app.vercel.app',
        email: 'support@tec.pi',
      },
    },
    servers: [
      {
        url:         'https://api-gateway-production-6a68.up.railway.app',
        description: 'Production',
      },
      {
        url:         'http://localhost:3000',
        description: 'Development',
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type:         'http',
          scheme:       'bearer',
          bearerFormat: 'JWT',
          description:  'JWT token من Pi Network login',
        },
      },
      schemas: {
        // ── Auth ──────────────────────────────────────────
        PiLoginRequest: {
          type: 'object',
          required: ['accessToken'],
          properties: {
            accessToken: { type: 'string', description: 'Pi Network access token' },
          },
        },
        AuthResponse: {
          type: 'object',
          properties: {
            success:   { type: 'boolean' },
            isNewUser: { type: 'boolean' },
            user: {
              type: 'object',
              properties: {
                id:               { type: 'string', format: 'uuid' },
                piId:             { type: 'string' },
                piUsername:       { type: 'string' },
                role:             { type: 'string', enum: ['user', 'admin'] },
                subscriptionPlan: { type: 'string', enum: ['FREE', 'PRO', 'ENTERPRISE'], nullable: true },
              },
            },
            tokens: {
              type: 'object',
              properties: {
                accessToken:  { type: 'string' },
                refreshToken: { type: 'string' },
              },
            },
          },
        },
        // ── Payment ───────────────────────────────────────
        CreatePaymentRequest: {
          type: 'object',
          required: ['userId', 'amount', 'currency', 'payment_method'],
          properties: {
            userId:         { type: 'string', format: 'uuid' },
            amount:         { type: 'number', minimum: 0.001 },
            currency:       { type: 'string', enum: ['PI'], default: 'PI' },
            payment_method: { type: 'string', enum: ['pi', 'card', 'wallet'] },
            metadata:       { type: 'object' },
          },
        },
        PaymentResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                payment: {
                  type: 'object',
                  properties: {
                    id:       { type: 'string', format: 'uuid' },
                    status:   { type: 'string', enum: ['created', 'approved', 'completed', 'cancelled', 'failed'] },
                    amount:   { type: 'number' },
                    currency: { type: 'string' },
                  },
                },
              },
            },
          },
        },
        // ── Wallet ────────────────────────────────────────
        WalletBalance: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            balance: { type: 'number' },
            currency: { type: 'string', default: 'TEC' },
          },
        },
        // ── Error ─────────────────────────────────────────
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', default: false },
            error: {
              type: 'object',
              properties: {
                code:    { type: 'string' },
                message: { type: 'string' },
              },
            },
          },
        },
      },
    },
    security: [{ BearerAuth: [] }],
    tags: [
      { name: 'Auth',          description: 'Pi Network authentication' },
      { name: 'Payment',       description: 'Pi payment processing' },
      { name: 'Wallet',        description: 'TEC wallet operations' },
      { name: 'Assets',        description: 'Digital asset management' },
      { name: 'Commerce',      description: 'Orders + subscriptions' },
      { name: 'Notifications', description: 'User notifications' },
      { name: 'KYC',           description: 'Identity verification' },
      { name: 'Analytics',     description: 'Platform analytics' },
      { name: 'Health',        description: 'Service health checks' },
    ],
    paths: {
      // ── Health ──────────────────────────────────────────
      '/health': {
        get: {
          tags:        ['Health'],
          summary:     'Gateway health check',
          security:    [],
          operationId: 'getHealth',
          responses: {
            '200': {
              description: 'Service is healthy',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status:     { type: 'string', example: 'ok' },
                      service:    { type: 'string', example: 'api-gateway' },
                      version:    { type: 'string' },
                      apiVersion: { type: 'string', example: 'v1' },
                      uptime:     { type: 'number' },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // ── Auth ────────────────────────────────────────────
      '/api/v1/auth/pi-login': {
        post: {
          tags:        ['Auth'],
          summary:     'Login with Pi Network',
          security:    [],
          operationId: 'piLogin',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { '$ref': '#/components/schemas/PiLoginRequest' },
              },
            },
          },
          responses: {
            '200': {
              description: 'Login successful',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/AuthResponse' },
                },
              },
            },
            '401': {
              description: 'Invalid Pi token',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },
      '/api/v1/auth/refresh': {
        post: {
          tags:        ['Auth'],
          summary:     'Refresh access token',
          operationId: 'refreshToken',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['refreshToken'],
                  properties: {
                    refreshToken: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Token refreshed',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { token: { type: 'string' } },
                  },
                },
              },
            },
          },
        },
      },
      '/api/v1/auth/logout': {
        post: {
          tags:        ['Auth'],
          summary:     'Logout and blacklist token',
          operationId: 'logout',
          responses: {
            '200': {
              description: 'Logged out successfully',
            },
          },
        },
      },
      // ── Payment ─────────────────────────────────────────
      '/api/v1/payment/create': {
        post: {
          tags:        ['Payment'],
          summary:     'Create a Pi payment',
          operationId: 'createPayment',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { '$ref': '#/components/schemas/CreatePaymentRequest' },
              },
            },
          },
          responses: {
            '201': {
              description: 'Payment created',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/PaymentResponse' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/payment/approve': {
        post: {
          tags:        ['Payment'],
          summary:     'Approve a Pi payment',
          operationId: 'approvePayment',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['payment_id', 'pi_payment_id'],
                  properties: {
                    payment_id:    { type: 'string', format: 'uuid' },
                    pi_payment_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Payment approved' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/payment/complete': {
        post: {
          tags:        ['Payment'],
          summary:     'Complete a Pi payment',
          operationId: 'completePayment',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['payment_id', 'transaction_id'],
                  properties: {
                    payment_id:     { type: 'string', format: 'uuid' },
                    transaction_id: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Payment completed' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/payments/history': {
        get: {
          tags:        ['Payment'],
          summary:     'Get payment history',
          operationId: 'getPaymentHistory',
          parameters: [
            { name: 'limit',  in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', default: 0  } },
            { name: 'sort',   in: 'query', schema: { type: 'string',  enum: ['asc', 'desc'], default: 'desc' } },
          ],
          responses: {
            '200': { description: 'Payment history' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      // ── Wallet ──────────────────────────────────────────
      '/api/v1/wallet/balance': {
        get: {
          tags:        ['Wallet'],
          summary:     'Get wallet balance',
          operationId: 'getWalletBalance',
          parameters: [
            { name: 'userId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
          ],
          responses: {
            '200': {
              description: 'Wallet balance',
              content: {
                'application/json': {
                  schema: { '$ref': '#/components/schemas/WalletBalance' },
                },
              },
            },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/wallet/deposit': {
        post: {
          tags:        ['Wallet'],
          summary:     'Deposit to wallet',
          operationId: 'walletDeposit',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['userId', 'amount'],
                  properties: {
                    userId:    { type: 'string', format: 'uuid' },
                    amount:    { type: 'number' },
                    reference: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: {
            '200': { description: 'Deposit successful' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      // ── Commerce ─────────────────────────────────────────
      '/api/v1/commerce/orders': {
        get: {
          tags:        ['Commerce'],
          summary:     'List orders',
          operationId: 'listOrders',
          parameters: [
            { name: 'buyer_id', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'page',     in: 'query', schema: { type: 'integer', default: 1 } },
            { name: 'limit',    in: 'query', schema: { type: 'integer', default: 10 } },
            { name: 'status',   in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Orders list' },
            '401': { description: 'Unauthorized' },
          },
        },
        post: {
          tags:        ['Commerce'],
          summary:     'Create order',
          operationId: 'createOrder',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['buyer_id', 'items'],
                  properties: {
                    buyer_id: { type: 'string', format: 'uuid' },
                    items: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          product_id: { type: 'string' },
                          quantity:   { type: 'integer', minimum: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            '201': { description: 'Order created' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      '/api/v1/commerce/subscriptions/plans': {
        get: {
          tags:        ['Commerce'],
          summary:     'Get subscription plans',
          security:    [],
          operationId: 'getPlans',
          responses: {
            '200': {
              description: 'Available plans',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean' },
                      data: {
                        type: 'object',
                        properties: {
                          plans: {
                            type: 'array',
                            items: {
                              type: 'object',
                              properties: {
                                id:       { type: 'string', enum: ['FREE', 'PRO', 'ENTERPRISE'] },
                                name:     { type: 'string' },
                                price:    { type: 'number' },
                                currency: { type: 'string' },
                                features: { type: 'array', items: { type: 'string' } },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      // ── KYC ─────────────────────────────────────────────
      '/api/v1/kyc/status': {
        get: {
          tags:        ['KYC'],
          summary:     'Get KYC status',
          operationId: 'getKycStatus',
          responses: {
            '200': { description: 'KYC status' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      // ── Notifications ────────────────────────────────────
      '/api/v1/notifications': {
        get: {
          tags:        ['Notifications'],
          summary:     'Get user notifications',
          operationId: 'getNotifications',
          parameters: [
            { name: 'page',  in: 'query', schema: { type: 'integer', default: 1  } },
            { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          ],
          responses: {
            '200': { description: 'Notifications list' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
      // ── Analytics ────────────────────────────────────────
      '/api/v1/analytics/overview': {
        get: {
          tags:        ['Analytics'],
          summary:     'Get analytics overview',
          operationId: 'getAnalyticsOverview',
          responses: {
            '200': { description: 'Analytics data' },
            '401': { description: 'Unauthorized' },
          },
        },
      },
    },
  },
  apis: [],
});

async function bootstrap() {
  const app    = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  
app.useGlobalFilters(new GlobalExceptionFilter());

  app.enableCors({
    origin:         process.env.CORS_ORIGIN?.split(',') || '*',
    credentials:    true,
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-request-id'],
  });

  const httpAdapter = app.getHttpAdapter();
  const expressApp  = httpAdapter.getInstance();

  // ── API Version header ────────────────────────────────
  expressApp.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-api-version', 'v1');
    res.setHeader('x-powered-by', 'TEC Gateway');
    next();
  });

  // ── Swagger UI ────────────────────────────────────────
  expressApp.use(
    '/api/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: 'TEC API Docs',
      customCss: `
        .swagger-ui .topbar { background: #0d0d14; }
        .swagger-ui .topbar-wrapper .link { display: none; }
      `,
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion:         'list',
        filter:               true,
        displayRequestDuration: true,
      },
    }),
  );

  // ── Swagger JSON ──────────────────────────────────────
  expressApp.get('/api/docs.json', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });
  
// ── Rate Limiting ─────────────────────────────────────
expressApp.use('/api/v1/auth',    authRateLimiter);
expressApp.use('/api/auth',       authRateLimiter);
expressApp.use('/api/v1/payment', paymentRateLimiter);
expressApp.use('/api/payment',    paymentRateLimiter);

// ✅ Global rate limiter — يستثني health/ready/docs
expressApp.use((req: Request, res: Response, next: NextFunction) => {
  const excluded = ['/health', '/ready', '/api/docs', '/api/docs.json'];
  if (excluded.some(path => req.path.startsWith(path))) {
    return next();
  }
  return rateLimiter(req, res, next);
});
  
  // ── Register proxy routes ─────────────────────────────
  const proxyService = app.get(ProxyService);
  proxyService.registerProxies(expressApp);

  // ── Health ────────────────────────────────────────────
  expressApp.get('/health', (_req: Request, res: Response) => {
    const uptime = Math.floor((Date.now() - serviceStartTime) / 1000);
    res.json({
      status:     'ok',
      service:    'api-gateway',
      version:    SERVICE_VERSION,
      apiVersion: 'v1',
      timestamp:  new Date().toISOString(),
      uptime,
      docs:       '/api/docs',
    });
  });

  // ── Ready ─────────────────────────────────────────────
  expressApp.get('/ready', (_req: Request, res: Response) => {
    res.json({ status: 'ready', service: 'api-gateway', apiVersion: 'v1' });
  });

  // ── 404 ───────────────────────────────────────────────
  expressApp.use('*', (_req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
    });
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);
  logger.log(`🚀 TEC Gateway v1 running on port ${port}`);
  logger.log(`📚 API Docs: http://localhost:${port}/api/docs`);
  logger.log(`📡 New routes:    /api/v1/{service}`);
  logger.log(`🔄 Legacy routes: /api/{service} (backward compat)`);
}

bootstrap();
