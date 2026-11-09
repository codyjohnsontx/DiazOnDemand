-- A ban is a fact about the member, not about one subscription: while
-- "bannedAt" is set the member has no premium access whatever their
-- subscriptions say, and checkout refuses them, until an admin lifts it. Who
-- banned them and why live in "MemberAccessAudit", under the two new actions.
--
-- Additive only: one nullable column and two enum values. "Subscription"."adminRevokedAt"
-- is left in place, no longer read, for a later migration to drop.

-- AlterEnum
ALTER TYPE "MemberAccessAction" ADD VALUE 'BAN';
ALTER TYPE "MemberAccessAction" ADD VALUE 'UNBAN';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);

-- An admin revocation of Stripe access already did everything a ban does: no
-- access through renewals and new subscriptions, and checkout refused. Every
-- member carrying one becomes banned from the first such revocation, so their
-- access is exactly what it was. Staff then review each one's recorded reason
-- on the members screen and lift those that were not abuse.
--
-- No audit row is written. The existing REVOKE rows are the record of who did
-- it and why, and a row saying an admin banned somebody today would be false.
UPDATE "User" u
SET "bannedAt" = s.first_revoked
FROM (
  SELECT "userId", MIN("adminRevokedAt") AS first_revoked
  FROM "Subscription"
  WHERE "adminRevokedAt" IS NOT NULL
  GROUP BY "userId"
) s
WHERE s."userId" = u.id;
