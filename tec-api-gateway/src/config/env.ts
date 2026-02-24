import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  AUTH_SERVICE_URL: z.string().url(),
  WALLET_SERVICE_URL: z.string().url(),
  PAYMENT_SERVICE_URL: z.string().url(),
  // Observability (all optional — safe defaults applied in infra/logger.ts etc.)
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  SERVICE_NAME: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
