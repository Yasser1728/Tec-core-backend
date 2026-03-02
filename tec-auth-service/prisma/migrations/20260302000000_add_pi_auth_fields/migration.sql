-- AlterTable: make email and password_hash nullable, add pi_uid and pi_username
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN "pi_uid" TEXT;
ALTER TABLE "users" ADD COLUMN "pi_username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_pi_uid_key" ON "users"("pi_uid");
