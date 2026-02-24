-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('PAYMENT_INITIATED', 'PAYMENT_APPROVED', 'PAYMENT_CONFIRMED', 'PAYMENT_CANCELLED', 'PAYMENT_FAILED', 'INVALID_TRANSITION_ATTEMPT');

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'PI',
    "payment_method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "pi_payment_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentId" TEXT,
    "eventType" "AuditEventType" NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "requestId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_pi_payment_id_key" ON "payments"("pi_payment_id");

-- CreateIndex
CREATE INDEX "payments_user_id_idx" ON "payments"("user_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE INDEX "payment_audit_logs_userId_idx" ON "payment_audit_logs"("userId");

-- CreateIndex
CREATE INDEX "payment_audit_logs_paymentId_idx" ON "payment_audit_logs"("paymentId");

-- CreateIndex: support time-range queries over audit logs
CREATE INDEX "payment_audit_logs_timestamp_idx" ON "payment_audit_logs"("timestamp");

-- AddForeignKey: enforce referential integrity between audit logs and payments
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
