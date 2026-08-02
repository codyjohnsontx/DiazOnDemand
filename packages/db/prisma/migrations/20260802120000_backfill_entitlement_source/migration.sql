-- Entitlement.source was added with DEFAULT 'MANUAL', which relabelled every row
-- the Stripe webhook had already written. The guard that protects a manual grant
-- then refuses to downgrade them, so a refund or chargeback would take a
-- pre-existing member's money back and leave their access standing.
--
-- Safe because no route granted an entitlement by hand before this change: any
-- entitlement belonging to a user with a Subscription row was written by Stripe.
UPDATE "Entitlement" SET source = 'STRIPE' WHERE "userId" IN (SELECT "userId" FROM "Subscription");
