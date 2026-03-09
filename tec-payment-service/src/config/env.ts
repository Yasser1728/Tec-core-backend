import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  PI_API_KEY: z.string().default(''),
  PI_APP_ID: z.string().default(''),
  // Pi Network environment: 'true' = Testnet/Sandbox (default), 'false' = Mainnet/Production
  PI_SANDBOX: z.string().default('true'),
  // Pi API request timeouts in milliseconds (default: 30 000)
  PI_API_APPROVE_TIMEOUT: z.coerce.number().positive().default(30000),
  PI_API_COMPLETE_TIMEOUT: z.coerce.number().positive().default(30000),
  // Stale payment reconciliation thresholds in milliseconds
  RECONCILE_CREATED_THRESHOLD_MS: z.coerce.number().positive().default(1800000),
  RECONCILE_APPROVED_THRESHOLD_MS: z.coerce.number().positive().default(3600000),
  // Internal service-to-service auth secret
  INTERNAL_SECRET: z.string().min(1).optional(),
  // Wallet service URL for TEC crediting after Pi payment completion
  WALLET_SERVICE_URL: z.string().url().optional(),
  // Observability (all optional — safe defaults applied in infra/logger.ts etc.)
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  SERVICE_NAME: z.string().optional(),
  SENTRY_DSN: z.string().url().optional(),
});

export const env = envSchema.parse(process.env);
