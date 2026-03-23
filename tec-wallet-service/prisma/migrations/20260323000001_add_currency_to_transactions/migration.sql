ALTER TABLE "transactions"
  ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'PI';

CREATE INDEX IF NOT EXISTS "transactions_currency_idx" ON "transactions"("currency");
