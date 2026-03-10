-- Align users table with production schema:
-- Remove username column (never existed in production DB), ensure pi_uid/pi_username exist.

-- Drop username column if it exists (handles environments where the old init migration ran)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'username'
  ) THEN
    ALTER TABLE "users" DROP COLUMN "username";
  END IF;
END $$;

-- Drop stale username unique index if present
DROP INDEX IF EXISTS "users_username_key";

-- Ensure pi_uid column exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'pi_uid'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "pi_uid" TEXT;
  END IF;
END $$;

-- Ensure pi_username column exists
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'pi_username'
  ) THEN
    ALTER TABLE "users" ADD COLUMN "pi_username" TEXT;
  END IF;
END $$;

-- Ensure email is nullable
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'email'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
  END IF;
END $$;

-- Ensure password_hash is nullable
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
  END IF;
END $$;

-- Ensure unique index on pi_uid exists
CREATE UNIQUE INDEX IF NOT EXISTS "users_pi_uid_key" ON "users"("pi_uid");
