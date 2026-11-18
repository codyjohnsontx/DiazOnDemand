-- Turns every admin revocation still in force into a ban, dated from the
-- member's first such revocation.
--
-- An admin revocation of Stripe access did what a ban does: renewals and new
-- subscriptions granted nothing (a new subscription inherited the stamp), and
-- checkout was refused. It stopped being in force for a member an admin gave
-- access back to, in one of two ways, and those members are not banned:
--   - a live manual grant, issued after the revocation, or
--   - a live subscription without the stamp, which only an admin's restore of
--     that subscription leaves behind.
-- They keep exactly the access they have, and their stamps stay where they are,
-- unread, for the later migration that drops the column. For every member who
-- is banned, the stamps were already withholding all access, so the ban changes
-- nothing about what they can watch. Staff then review each recorded reason on
-- the members screen and lift those that were not abuse.
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
WHERE s."userId" = u.id
  AND NOT EXISTS (
    SELECT 1 FROM "Entitlement" e
    WHERE e."userId" = u.id
      AND e.source = 'MANUAL'
      AND e.tier = 'PREMIUM'
      AND (e."validUntil" IS NULL OR e."validUntil" > NOW())
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Subscription" live
    WHERE live."userId" = u.id
      AND live."adminRevokedAt" IS NULL
      AND live."revokedAt" IS NULL
      AND live.status IN ('trialing', 'active', 'past_due')
  );

-- A banned member's entitlement is FREE, exactly what the entitlement sync
-- writes for one, so no banned member can hold PREMIUM.
UPDATE "Entitlement"
SET tier = 'FREE', "validUntil" = NULL, source = 'MANUAL'
WHERE "userId" IN (SELECT id FROM "User" WHERE "bannedAt" IS NOT NULL);
