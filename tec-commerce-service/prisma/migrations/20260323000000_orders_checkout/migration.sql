-- Add missing columns to orders table
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "pi_payment_id" TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "shipping_addr"  TEXT,
  ADD COLUMN IF NOT EXISTS "paid_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "shipped_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "delivered_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelled_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancel_reason"  TEXT;

-- Add missing column to order_items
ALTER TABLE "order_items"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'PI',
  ADD COLUMN IF NOT EXISTS "snapshot" JSONB;

-- Order timeline table
CREATE TABLE IF NOT EXISTS "order_timeline" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "order_id"   TEXT NOT NULL,
  "status"     TEXT NOT NULL,
  "note"       TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_timeline_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_timeline_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "order_timeline_order_id_idx" ON "order_timeline"("order_id");
CREATE INDEX IF NOT EXISTS "orders_pi_payment_id_idx"    ON "orders"("pi_payment_id");
CREATE INDEX IF NOT EXISTS "orders_created_at_idx"       ON "orders"("created_at");
CREATE INDEX IF NOT EXISTS "order_items_order_id_idx"    ON "order_items"("order_id");
CREATE INDEX IF NOT EXISTS "order_items_product_id_idx"  ON "order_items"("product_id");

-- Update order status enum values
ALTER TABLE "orders"
  ALTER COLUMN "status" SET DEFAULT 'PENDING';
