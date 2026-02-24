-- AlterTable: add soft-delete column to wallets
ALTER TABLE "wallets" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- AlterTable: add soft-delete column to accounts
ALTER TABLE "accounts" ADD COLUMN "deleted_at" TIMESTAMP(3);
