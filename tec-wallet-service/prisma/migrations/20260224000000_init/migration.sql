-- CreateTable (safe)
CREATE TABLE IF NOT EXISTS "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "wallet_type" TEXT NOT NULL,
    "wallet_address" TEXT,
    "currency" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "transactions" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "asset_type" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "user_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (safe)
CREATE UNIQUE INDEX IF NOT EXISTS "wallets_wallet_address_key" ON "wallets"("wallet_address");
CREATE INDEX IF NOT EXISTS "wallets_user_id_idx" ON "wallets"("user_id");
CREATE INDEX IF NOT EXISTS "transactions_wallet_id_idx" ON "transactions"("wallet_id");
CREATE INDEX IF NOT EXISTS "transactions_status_idx" ON "transactions"("status");
CREATE INDEX IF NOT EXISTS "transactions_created_at_idx" ON "transactions"("created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "accounts_user_id_currency_code_key" ON "accounts"("user_id", "currency_code");
CREATE INDEX IF NOT EXISTS "accounts_user_id_idx" ON "accounts"("user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- AddForeignKey (safe)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'transactions_wallet_id_fkey'
  ) THEN
    ALTER TABLE "transactions" ADD CONSTRAINT "transactions_wallet_id_fkey" 
    FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") 
    ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
