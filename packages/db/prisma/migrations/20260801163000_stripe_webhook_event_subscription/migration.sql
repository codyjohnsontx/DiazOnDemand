-- AlterTable
ALTER TABLE "StripeWebhookEvent" ADD COLUMN     "stripeSubscriptionId" TEXT;

-- CreateIndex
CREATE INDEX "StripeWebhookEvent_stripeSubscriptionId_idx" ON "StripeWebhookEvent"("stripeSubscriptionId");
