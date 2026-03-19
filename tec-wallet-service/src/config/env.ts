import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  INTERNAL_SECRET: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  SERVICE_NAME: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
  // ✅ أضفنا REDIS_URL
  REDIS_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);
