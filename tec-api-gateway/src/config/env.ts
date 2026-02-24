import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  AUTH_SERVICE_URL: z.string().url(),
  WALLET_SERVICE_URL: z.string().url(),
  PAYMENT_SERVICE_URL: z.string().url(),
});

export const env = envSchema.parse(process.env);
