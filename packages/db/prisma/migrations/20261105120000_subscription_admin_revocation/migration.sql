-- An admin withdrawing a subscription's access is kept apart from "revokedAt"
-- and "revokedReason", which record what Stripe reported, so a refund or
-- chargeback landing on the row cannot overwrite the admin's decision and a won
-- dispute cannot clear it. Who did it and why stay in "MemberAccessAudit".
--
-- Additive only: one nullable column, nothing existing is altered.

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "adminRevokedAt" TIMESTAMP(3);
