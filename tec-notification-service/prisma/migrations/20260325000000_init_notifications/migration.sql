-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('PAYMENT', 'WALLET', 'KYC', 'SECURITY', 'SYSTEM');

-- Notifications table
CREATE TABLE IF NOT EXISTS "notifications" (
  "id"         TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id"    TEXT NOT NULL,
  "type"       "NotificationType" NOT NULL,
  "title"      TEXT NOT NULL,
  "message"    TEXT NOT NULL,
  "read"       BOOLEAN NOT NULL DEFAULT false,
  "metadata"   JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_user_id_idx"   ON "notifications"("user_id");
CREATE INDEX IF NOT EXISTS "notifications_read_idx"      ON "notifications"("read");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications"("created_at");

-- NotificationPreference table
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id"      TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "user_id" TEXT NOT NULL,
  "in_app"  BOOLEAN NOT NULL DEFAULT true,
  "email"   BOOLEAN NOT NULL DEFAULT false,
  "push"    BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "notification_preferences_pkey"         PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_user_id_key"  UNIQUE ("user_id")
);
