-- AlterTable: add transaction_id column to payments
-- Stores the blockchain transaction ID once a Pi Network payment is completed.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "transaction_id" TEXT;
