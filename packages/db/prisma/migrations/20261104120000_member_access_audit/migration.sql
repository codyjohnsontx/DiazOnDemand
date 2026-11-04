-- The audit trail behind the admin members screen: who granted, revoked or
-- restored a member's access, what the access was on either side of the change,
-- the reason they gave, and when.
--
-- Additive only: one new enum and one new table, nothing existing is altered.
-- A member's audit rows go with the member (ON DELETE CASCADE); an acting
-- admin's rows outlive the admin's own account (ON DELETE SET NULL), and
-- "actorClerkUserId" keeps who it was.

-- CreateEnum
CREATE TYPE "MemberAccessAction" AS ENUM ('GRANT', 'REVOKE', 'RESTORE_REFUND');

-- CreateTable
CREATE TABLE "MemberAccessAudit" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorClerkUserId" TEXT NOT NULL,
    "action" "MemberAccessAction" NOT NULL,
    "reason" TEXT,
    "tierBefore" "EntitlementTier" NOT NULL,
    "validUntilBefore" TIMESTAMP(3),
    "tierAfter" "EntitlementTier" NOT NULL,
    "validUntilAfter" TIMESTAMP(3),
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberAccessAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberAccessAudit_memberId_createdAt_idx" ON "MemberAccessAudit"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberAccessAudit_actorId_idx" ON "MemberAccessAudit"("actorId");

-- AddForeignKey
ALTER TABLE "MemberAccessAudit" ADD CONSTRAINT "MemberAccessAudit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAccessAudit" ADD CONSTRAINT "MemberAccessAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

