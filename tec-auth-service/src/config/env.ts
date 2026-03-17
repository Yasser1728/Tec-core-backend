import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),
  REFRESH_TOKEN_SECRET: z.string().min(32),

  PI_API_KEY: z.string().optional(),
  PI_SANDBOX_CLIENT_ID: z.string().optional(),
  PI_SANDBOX_CLIENT_SECRET: z.string().optional(),
  PI_MAINNET_CLIENT_ID: z.string().optional(),
  PI_MAINNET_CLIENT_SECRET: z.string().optional(),

  API_BASE_URL: z.string().url(),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
  SENTRY_DSN: z.string().url().optional(),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),

  ENABLE_EVENTS: z.coerce.boolean().default(false),
}).refine((env) => {
  if (env.NODE_ENV === 'production') {
    return env.PI_MAINNET_CLIENT_ID && env.PI_MAINNET_CLIENT_SECRET;
  }
  return true;
}, {
  message: "Mainnet Pi credentials required in production",
});

export const env = envSchema.parse(process.env);
