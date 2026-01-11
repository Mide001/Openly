/*
  Warnings:

  - You are about to drop the column `externalCustomerId` on the `Customer` table. All the data in the column will be lost.
  - You are about to drop the column `apiKey` on the `Merchant` table. All the data in the column will be lost.
  - You are about to drop the column `apiKeyHash` on the `Merchant` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[merchantId,email]` on the table `Customer` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[apiKeyHashLive]` on the table `Merchant` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[apiKeyHashTest]` on the table `Merchant` will be added. If there are existing duplicate values, this will fail.
  - Made the column `email` on table `Customer` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `apiKeyHashLive` to the `Merchant` table without a default value. This is not possible if the table is not empty.
  - Added the required column `apiKeyHashTest` to the `Merchant` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Customer_merchantId_externalCustomerId_key";

-- DropIndex
DROP INDEX "Merchant_apiKey_idx";

-- DropIndex
DROP INDEX "Merchant_apiKey_key";

-- AlterTable
ALTER TABLE "Customer" DROP COLUMN "externalCustomerId",
ALTER COLUMN "email" SET NOT NULL;

-- AlterTable
ALTER TABLE "Merchant" DROP COLUMN "apiKey",
DROP COLUMN "apiKeyHash",
ADD COLUMN     "apiKeyHashLive" TEXT NOT NULL,
ADD COLUMN     "apiKeyHashTest" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "network" TEXT NOT NULL DEFAULT 'TESTNET';

-- CreateIndex
CREATE UNIQUE INDEX "Customer_merchantId_email_key" ON "Customer"("merchantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_apiKeyHashLive_key" ON "Merchant"("apiKeyHashLive");

-- CreateIndex
CREATE UNIQUE INDEX "Merchant_apiKeyHashTest_key" ON "Merchant"("apiKeyHashTest");

-- CreateIndex
CREATE INDEX "Merchant_apiKeyHashLive_idx" ON "Merchant"("apiKeyHashLive");

-- CreateIndex
CREATE INDEX "Merchant_apiKeyHashTest_idx" ON "Merchant"("apiKeyHashTest");
