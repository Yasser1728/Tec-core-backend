-- CreateTable device_tokens
CREATE TABLE IF NOT EXISTS "device_tokens" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"    TEXT NOT NULL,
  "token"      TEXT NOT NULL,
  "platform"   TEXT NOT NULL DEFAULT 'web',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "device_tokens_token_key" UNIQUE ("token")
);

CREATE INDEX IF NOT EXISTS "device_tokens_user_id_idx" ON "device_tokens"("user_id");
