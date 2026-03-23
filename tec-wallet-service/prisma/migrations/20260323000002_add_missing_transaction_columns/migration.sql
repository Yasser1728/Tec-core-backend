-- tx_hash
ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "tx_hash"   TEXT,
  ADD COLUMN IF NOT EXISTS "from_addr" TEXT,
  ADD COLUMN IF NOT EXISTS "to_addr"   TEXT,
  ADD COLUMN IF NOT EXISTS "memo"      TEXT;

-- Unique index for tx_hash
CREATE UNIQUE INDEX IF NOT EXISTS "transactions_tx_hash_key" ON "transactions"("tx_hash")
  WHERE "tx_hash" IS NOT NULL;
