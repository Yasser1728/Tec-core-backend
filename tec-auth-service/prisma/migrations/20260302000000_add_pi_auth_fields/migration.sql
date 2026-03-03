-- Create users table if not exists
CREATE TABLE IF NOT EXISTS "users" (
  "id"            TEXT NOT NULL,
  "email"         TEXT,
  "password_hash" TEXT,
  "pi_uid"        TEXT,
  "pi_username"   TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- Add columns only if they don't exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='users' AND column_name='pi_uid'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "pi_uid" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='users' AND column_name='pi_username'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "pi_username" TEXT;
  END IF;
END $$;

-- Make email and password nullable
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- Create unique index if not exists
CREATE UNIQUE INDEX IF NOT EXISTS "users_pi_uid_key" ON "users"("pi_uid");
