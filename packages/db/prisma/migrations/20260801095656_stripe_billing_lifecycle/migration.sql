-- CreateEnum
CREATE TYPE "EntitlementSource" AS ENUM ('MANUAL', 'STRIPE');

-- CreateEnum
CREATE TYPE "StripeWebhookEventStatus" AS ENUM ('PROCESSED', 'FAILED');

-- DropIndex
DROP INDEX "Subscription_userId_key";

-- AlterTable
ALTER TABLE "Entitlement" ADD COLUMN     "source" "EntitlementSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "lastEventAt" TIMESTAMP(3),
ADD COLUMN     "revokedAt" TIMESTAMP(3),
ADD COLUMN     "revokedReason" TEXT;

-- CreateTable
CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "StripeWebhookEventStatus" NOT NULL,
    "stripeCreatedAt" TIMESTAMP(3) NOT NULL,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_status_receivedAt_idx" ON "StripeWebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");
