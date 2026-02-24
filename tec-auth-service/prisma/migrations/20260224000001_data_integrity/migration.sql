-- AddColumn: track when a subscription was last modified
ALTER TABLE "subscriptions" ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex: speed up session lookups by user
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex: speed up device lookups by user
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex: support lockout queries by user and by email
CREATE INDEX "login_attempts_user_id_idx" ON "login_attempts"("user_id");
CREATE INDEX "login_attempts_email_idx" ON "login_attempts"("email");

-- CreateIndex: speed up audit-log lookups by user
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");

-- CreateIndex: cover the common query pattern (user_id + status = 'active')
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");
