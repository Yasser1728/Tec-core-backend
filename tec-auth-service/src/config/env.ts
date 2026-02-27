import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  JWT_REFRESH_SECRET: z.string().min(1),
  // Internal service-to-service auth secret
  INTERNAL_SECRET: z.string().min(1).optional(),
  // Observability (all optional — safe defaults applied in infra/logger.ts etc.)
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  SERVICE_NAME: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
