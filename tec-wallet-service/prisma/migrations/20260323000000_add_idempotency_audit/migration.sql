-- Add missing columns to transactions table
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "asset_type"  TEXT NOT NULL DEFAULT 'PI',
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "payment_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "metadata"    JSONB;

-- Index for idempotency lookup
CREATE INDEX IF NOT EXISTS "transactions_description_idx" ON "transactions"("description");
CREATE INDEX IF NOT EXISTS "transactions_payment_id_idx"  ON "transactions"("payment_id");

-- AuditLog table
CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "action"     TEXT NOT NULL,
  "entity"     TEXT NOT NULL,
  "entity_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "metadata"   JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_entity_id_idx"  ON "audit_logs"("entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx"    ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx"     ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- ProcessedEvent table (Idempotency)
CREATE TABLE IF NOT EXISTS "processed_events" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "event_key"    TEXT NOT NULL,
  "user_id"      TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "processed_events_pkey"      PRIMARY KEY ("id"),
  CONSTRAINT "processed_events_event_key_key" UNIQUE ("event_key")
);

CREATE INDEX IF NOT EXISTS "processed_events_event_key_idx" ON "processed_events"("event_key");
CREATE INDEX IF NOT EXISTS "processed_events_user_id_idx"   ON "processed_events"("user_id");
