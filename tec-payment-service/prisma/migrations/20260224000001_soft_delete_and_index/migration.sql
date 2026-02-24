-- AlterTable: add soft-delete column to payments
ALTER TABLE "payments" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateIndex: support paginated payment history ordered by time
CREATE INDEX "payments_created_at_idx" ON "payments"("created_at");
