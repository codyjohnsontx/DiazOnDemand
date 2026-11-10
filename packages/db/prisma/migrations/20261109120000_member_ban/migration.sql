-- A ban is a fact about the member, not about one subscription: while
-- "bannedAt" is set the member has no premium access whatever their
-- subscriptions say, and checkout refuses them, until an admin lifts it. Who
-- banned them and why live in "MemberAccessAudit", under the two new actions.
--
-- Additive only: one nullable column and two enum values. "Subscription"."adminRevokedAt"
-- is left in place, no longer read, for a later migration to drop. Turning the
-- existing admin revocations into bans is the next migration.

-- AlterEnum
ALTER TYPE "MemberAccessAction" ADD VALUE 'BAN';
ALTER TYPE "MemberAccessAction" ADD VALUE 'UNBAN';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "bannedAt" TIMESTAMP(3);
