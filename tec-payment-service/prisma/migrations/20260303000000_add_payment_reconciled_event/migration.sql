-- Ensure AuditEventType enum exists (guards against DB state where init migration
-- was recorded as applied but never actually executed).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuditEventType') THEN
    CREATE TYPE "AuditEventType" AS ENUM (
      -- Values from 20260224000000_init/migration.sql (kept in sync)
      'PAYMENT_INITIATED',
      'PAYMENT_APPROVED',
      'PAYMENT_CONFIRMED',
      'PAYMENT_CANCELLED',
      'PAYMENT_FAILED',
      'INVALID_TRANSITION_ATTEMPT'
    );
  END IF;
END $$;

-- AlterEnum: add PAYMENT_WEBHOOK_RECEIVED (present in schema but missing from earlier migrations)
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_WEBHOOK_RECEIVED';

-- AlterEnum
ALTER TYPE "AuditEventType" ADD VALUE IF NOT EXISTS 'PAYMENT_RECONCILED';
