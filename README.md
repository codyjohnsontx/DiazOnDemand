# Diaz on Demand Monorepo

Video-on-demand product monorepo for Diaz on Demand. This repo contains:
- `apps/diaz-ondemand-web`: Next.js web app (admin portal + student web player)
- `apps/api`: NestJS REST API
- `apps/mobile`: Expo React Native student app
- `packages/db`: Prisma schema, client, seed script
- `packages/shared`: shared enums, zod schemas, typed API helper
- `packages/ui`: minimal shared UI component(s)

## Stack Summary
- Monorepo: Turborepo + pnpm workspaces
- Language: TypeScript everywhere
- Web: Next.js 15 + Tailwind
- API: NestJS + Prisma + Postgres
- Mobile: Expo + React Navigation + expo-av
- Auth: Clerk (with local dev bypass mode)
- Billing: Stripe subscriptions + webhooks
- Video: Mux playback IDs with public/free and signed/premium playback handling

## MVP Features Included
- Browse Programs/Courses/Lessons (published only)
- Lesson playback on web and mobile using Mux playback IDs
- Progress upsert (`lastPositionSeconds`, `completed`)
- Favorites create/list/remove
- Admin CRUD + publish/unpublish for programs/courses/lessons
- Entitlement gating for paid lessons (`FREE` vs `PREMIUM`)
- Stripe checkout session endpoint, and a Stripe billing portal endpoint so members can cancel
- Stripe webhook handler syncing `Subscription` history + `Entitlement`, including refunds and
  chargebacks
- Mux webhook with signature verification, syncing playback ID + duration on `video.asset.ready`

## Repository Layout
- `/apps/api`
- `/apps/diaz-ondemand-web`
- `/apps/mobile`
- `/packages/db`
- `/packages/shared`
- `/packages/ui`

## Separate Website Repo
- `https://github.com/codyjohnsontx/DiazMartialArts.git`
- `git@github.com:codyjohnsontx/DiazMartialArts.git`

## Environment Variables
Root `.env.example` is the catalog of every variable. At runtime each app loads its own
file: the API the monorepo-root `.env`, Next.js `apps/diaz-ondemand-web/.env`, Expo
`apps/mobile/.env`. See "Local Setup" below.

Required core values:
- `DATABASE_URL`
- `DEV_BYPASS_AUTH` (`false` everywhere except local development - see below)
- `DEFAULT_DEV_CLERK_USER_ID`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_DEV_BYPASS_AUTH` (`true` only for local development bypass)
- `VOD_COMING_SOON` (`true` in production while the VOD app is hidden)
- `NEXT_PUBLIC_VOD_COMING_SOON` (`true` in production while the VOD app is hidden)
- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_DEV_BYPASS_AUTH` (`true` only for local development bypass)

Auth (Clerk):
- `CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_JWT_ISSUER`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`

Stripe:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID_MONTHLY`
- `WEB_APP_URL`
- `BILLING_ALERT_WEBHOOK_URL` (optional; Slack/Discord incoming webhook for billing failures. Leave
  it unset for log-only alerts - an empty value is rejected as an invalid URL, not treated as unset,
  which is why it is documented here and deliberately kept out of `.env.example`)

Mux (optional locally; the webhook secret and the signing key pair are required on any
deployment):
- `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` (API access token, from Settings > Access Tokens)
- `MUX_WEBHOOK_SECRET` (webhook signing secret; **required on any deployment**, with no "is Mux
  enabled" condition attached - see "Vercel Deployment Notes")
- `MUX_SIGNING_KEY_ID` / `MUX_SIGNING_KEY_PRIVATE` (signing key, from Settings > Signing Keys - a
  separate credential from the access token; signs the RS256 playback JWTs for `PAID` lessons.
  Optional locally, **required on any deployment** - see "Vercel Deployment Notes")

Seed helper:
- `SEED_DEV_CLERK_USER_ID`

## Local Setup
1. Install deps:
```bash
corepack prepare pnpm@9.12.3 --activate
pnpm install
```

2. Configure env. Each app reads its own `.env`, and turbo forwards nothing between them:
the API loads the monorepo-root `.env` (see `apps/api/src/create-app.ts`), Next.js loads
`apps/diaz-ondemand-web/.env`, and Expo loads `apps/mobile/.env`. Copy the root and mobile
ones:

```bash
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
```

Copy the web one **only** when you have real Clerk credentials to put in it - see the next
paragraph for why an example-only copy is worse than no file:

```bash
cp apps/diaz-ondemand-web/.env.example apps/diaz-ondemand-web/.env
```

Every `.env.example` ships the auth bypass flags as `false`, so a fresh copy leaves the API
with no working auth: it rejects the walkthrough below with `401` until you enable the bypass
or configure real Clerk credentials.

Copying the web example is what breaks the web app: with that file in place, `pnpm dev` serves
HTTP `500` on **every** route, including the unprotected home page `/`. The trigger is an
`apps/diaz-ondemand-web/.env` that carries a publishable key but no `CLERK_SECRET_KEY` -
`clerkMiddleware` then throws `@clerk/nextjs: Missing secretKey` in the Edge runtime before any
provider mounts. `CLERK_SECRET_KEY` ships in the root and `apps/api/.env.example`, but not in
`apps/diaz-ondemand-web/.env.example`, and that is the file Next.js reads. The bypass flags
being `false` is not the trigger: the same example previously shipped
`NEXT_PUBLIC_DEV_BYPASS_AUTH=true` with the same placeholder publishable key and no secret key,
and `500`s identically. The middleware behaviour is not new, but copying that example is what
puts a web `.env` in place at all - with no `apps/diaz-ondemand-web/.env`, the web app starts
and serves pages normally, with no Clerk error.

What actually works, each verified by running it:
- **Local bypass (fastest), and the recommended local setup:** set `DEV_BYPASS_AUTH=true` in
  the root `.env`, and `EXPO_PUBLIC_DEV_BYPASS_AUTH=true` in `apps/mobile/.env` only if you are
  running the Expo app. Leave `apps/diaz-ondemand-web/.env` absent. The API then authenticates a
  request carrying **no credentials at all** as the seeded admin; a request that does present a
  Bearer token still goes through Clerk verification. This requires a loopback `DATABASE_URL` -
  `localhost`, any `127.x.x.x` address such as `127.0.0.1`, or the IPv6 loopback written as
  `[::1]` - which is what the examples already ship; the API refuses to start with the bypass
  enabled against any other database. See "Clerk Setup Notes" below for what the bypass grants.
  With no `apps/diaz-ondemand-web/.env`, the web app that `pnpm dev` serves on
  `http://localhost:3000` works end to end against that API: `/`, `/library` and
  `/admin/programs` all render seeded content, and the header shows **ACCOUNT** rather than
  Sign In. The web client sends no token, so the API resolves its calls as the seeded admin.
  Note that `/admin/programs` is one of the protected routes listed in
  `apps/diaz-ondemand-web/middleware.ts`, so reading that file alone would suggest it cannot
  render here. The behaviour above is what the running app does, measured rather than derived;
  the mechanism is not fully understood, so re-test it after a Clerk upgrade instead of
  assuming this still holds.
- **Real Clerk auth:** put real Clerk credentials - **both** `CLERK_SECRET_KEY` and
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - in `apps/diaz-ondemand-web/.env`. Nothing less does it:
  the secret key alone clears `Missing secretKey` but then fails `Publishable key not valid`,
  because `pk_test_your_key` is a placeholder, and putting `CLERK_SECRET_KEY` in the root
  `.env` has no effect at all, since Next.js does not read that file. The API separately needs
  `CLERK_SECRET_KEY` and `CLERK_JWT_ISSUER` in the root `.env`.

3. Generate Prisma client and run migration:
```bash
pnpm db:generate
pnpm db:migrate
```

4. Seed sample data:
```bash
pnpm db:seed
```

5. Start web + api:
```bash
pnpm dev
```
This also runs workspace `@diaz/shared` and `@diaz/db` TypeScript watchers used by the API.

6. Start mobile separately:
```bash
pnpm dev:mobile
```

## Running Each App
- API: `pnpm --filter api dev` (`http://localhost:4000`, Swagger at `/docs`)
- Web: `pnpm --filter diaz-ondemand-web dev` (`http://localhost:3000`)
- Mobile: `pnpm --filter mobile dev`

## Vertical Slice Walkthrough
After seed:
1. Open web library at `http://localhost:3000/library`.
2. Open a lesson in the Instructor Showcase program and play it. Those three carry real
   YouTube demonstration clips and are the only seeded lessons with a video; the other 64
   show the not-yet-filmed state, which is deliberate - see "Catalogue video states" below.
3. Progress saves every ~10 seconds and before unload.
4. Open admin at `http://localhost:3000/admin/programs`.
5. Create/edit/publish content.
6. Paid lessons require premium entitlement (returns HTTP 402 otherwise).

## Catalogue Video States
Every published lesson resolves to exactly one of three states, and nothing else is allowed:

| State                            | Seeded lessons | What a member sees                                    |
| -------------------------------- | -------------: | ----------------------------------------------------- |
| Real playable video              |              0 | The player, with real Diaz instruction                |
| Labelled demonstration clip      |              3 | A YouTube clip, badged `Demo video` in the showcase    |
| Not yet filmed                   |             64 | "This lesson has not been filmed", no player, no error |

The catalogue previously seeded 16 lessons with mnemonic Mux playback ids (`seedgrddef101`
and siblings). Every one of them loaded the player and then failed with "Video does not
exist". They are cleared, and the API will no longer resolve an identifier that is provably
unusable - see `isValidMuxPlaybackId` in `packages/shared` and `resolveVideoProvider` in
`apps/api/src/content/lesson-presentation.ts`.

The cause is closed structurally, not just the symptom. `LessonSeed` in
`packages/db/prisma/seed-curriculum/programs.ts` **has no field for a Mux playback id**, so
the seed cannot invent one again - adding one is a compile error, which `pnpm typecheck`
catches. That matters because it makes the remaining ids trustworthy by construction: every
Mux id that reaches the database now arrives through the `video.asset.ready` webhook, which
only ever reports ids Mux itself issued. A seeded lesson is therefore either YouTube with a
real public video id, or not filmed. (Validating an id an admin types by hand against Mux is
deliberately deferred and tracked separately.)

The read-path rule remains as the backstop for rows this repository never wrote. It rejects a
known-bad set rather than guessing at a valid shape: the 16 seeded
placeholders, plus values unsafe to interpolate into `stream.mux.com/<id>.m3u8`. Everything
else is accepted, because Mux documents `PlaybackID.id` only as a string. **Do not add a
length floor.** An earlier version required 20 or more characters and so refused Mux's own
documented 18-character example `a1B2c3D4e5F6g7H8i9`, hiding a real video behind "not
filmed" - the same dishonesty this rule exists to prevent, pointed the other way. It also
cannot tell that an accepted identifier addresses anything: a mistyped but URL-safe id is
accepted and fails in the player, and only provider validation at a write boundary could
change that. Members get the
not-yet-filmed state instead of a broken player; staff still see the stored value in the
lesson editor, now with a non-blocking hint next to any identifier the read path will refuse,
in the editor and on the admin course lesson rows. A not-yet-filmed lesson also shows no
runtime to a member - the seeded `durationSeconds` stays as a planned length and still counts
towards course totals. Whether unfilmed lessons stay published is an open product decision.

### Waiting for Mux

A fourth state exists for staff only, and it is derived from the row rather than stored: a
lesson holding a `muxAssetId` with no `muxPlaybackId` and no `youtubeVideoId` is waiting for a
playback id. `isAwaitingMuxPlayback` in `packages/shared` is the only place that decides it, and
`where: { muxAssetId: { not: null }, muxPlaybackId: null, youtubeVideoId: null }` finds every
one of them - no status column, so nothing can fall out of step. Members see the not-yet-filmed
state, because nothing plays yet. Staff see a **Waiting for Mux** badge in the lesson editor and
on the admin course lesson rows. The stored `videoProvider` is deliberately not part of the
test: `syncMuxAsset` matches on the asset id alone and sets the provider itself, so a row that
lost its provider (re-running `pnpm db:seed` does exactly that) is still one the webhook will
complete.

A lesson can sit there indefinitely, and nothing alerts or times out. The four causes are
encoding still running, an upload that failed at Mux, a webhook that was never configured, and
- most likely of all, since uploads happen in the Mux dashboard and there is no in-app upload
UI - a `video.asset.ready` that was delivered *before* any lesson held the asset ID. The
webhook answers 201 for an asset no lesson matches, so Mux never retries it. **Remedy:** if the
asset is already Ready in Mux, redeliver its `video.asset.ready` event from the Mux dashboard
now that the lesson holds the asset ID. Both admin surfaces say so.

## Clerk Setup Notes (Web + Expo)
- `DEV_BYPASS_AUTH=true` authenticates a request carrying **no credentials at all** as the
  seeded admin, so it is local-only. The API refuses to start with it enabled unless
  `DATABASE_URL` points at a loopback host - `localhost`, any `127.x.x.x` address such as
  `127.0.0.1`, or the IPv6 loopback written as `[::1]` - whatever `NODE_ENV` says.
  `NODE_ENV` alone is not trusted, because nothing in this repo guarantees a host exports it.
  Verified end to end against the built API with `NODE_ENV` unset throughout: it exits without
  opening a port whenever `DEV_BYPASS_AUTH=true` meets a non-loopback `DATABASE_URL` - whether
  the flag arrives from the host environment or from an app-directory `.env` - and still boots
  and authenticates an uncredentialed request as the seeded admin on a loopback database.
- `DEV_BYPASS_AUTH=true` on the API is what enables the bypass. The client flags
  `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` / `EXPO_PUBLIC_DEV_BYPASS_AUTH=true` are separate: they
  make a client skip Clerk and send `x-dev-user-id`, so it acts as whichever seeded user
  `NEXT_PUBLIC_DEV_USER_ID` / `EXPO_PUBLIC_DEV_USER_ID` names. That defaults to `dev_clerk_user`,
  the same seeded admin the API already resolves an uncredentialed request to, so the two
  identities diverge only if you point one of those at a different id. A client without its flag
  simply sends no credentials. All three default to `false` in `.env.example`.
- API reads `x-dev-user-id` header and auto-upserts a user.
- For real Clerk auth, each app needs its own keys in its own `.env`: the API needs `CLERK_SECRET_KEY` and `CLERK_JWT_ISSUER` (for example `https://your-tenant.clerk.accounts.dev`) in the root `.env`; the web app needs **both** `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `apps/diaz-ondemand-web/.env`; Expo needs `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` in `apps/mobile/.env`. The web/mobile clients then forward bearer tokens to the API.
- The Expo sign-in screen (`apps/mobile/src/sign-in-screen.tsx`) answers identically for an
  address that has a Clerk account and one that does not, so it cannot be used to ask whether
  someone is a member. Turning on **Strict user enumeration protection** in the Clerk dashboard
  is the account owner's half of that, and is not done from this repo: it closes the
  response-timing difference the app cannot.
- Signing out revokes the session at Clerk, so it needs the network. Offline it fails and says
  so, rather than clearing the local token and showing a signed-out app while the session stays
  live server-side.

## Stripe + Webhooks
Billing endpoints (both Clerk-authenticated):
- `POST /billing/create-checkout-session` - starts a monthly subscription. Returns **409** for two
  different reasons, told apart by a `code` on the body so the client can say the right thing:
  `subscription_exists` (the member already has an active subscription) and `checkout_in_flight`
  (a checkout for them is already open). The codes live in `packages/shared/src/schemas.ts`.
  Reuses the member's existing Stripe customer, so one person stays one customer in Stripe.
- `POST /billing/cancel-checkout` - expires the abandoned Stripe session and releases the calling
  member's checkout lock, called by the cancel return page. Holds the lock instead when Stripe
  reports the session already **complete**. Takes no body: the member comes from the auth guard,
  never the request, so nobody can clear somebody else's lock.
- `POST /billing/create-portal-session` - opens Stripe's hosted billing portal, which is where a
  member cancels, changes their card, and downloads invoices. Returns **404** when the member has
  no Stripe customer yet.

Stripe webhook endpoint:
- `POST /webhooks/stripe`
- Handles:
  - `customer.subscription.created` / `.updated` / `.deleted`
  - `charge.refunded` - a **full** refund revokes access immediately; a partial refund does not
  - `charge.dispute.created` - a chargeback revokes access immediately
  - `charge.dispute.closed` - a dispute Diaz **won** restores the access that chargeback took
  - `checkout.session.completed` / `.expired` / `.async_payment_failed` - release the checkout lock
- Syncs:
  - a `Subscription` row per Stripe subscription. This is a **history**, not one row per member:
    a member who cancels and resubscribes gets a new Stripe subscription id, and both rows are
    kept.
  - the `Entitlement`, always **derived from the member's stored subscriptions** rather than from
    the event in hand. `PREMIUM` while any unrevoked subscription is `active`/`trialing`/`past_due`,
    otherwise `FREE`. `Entitlement.source` records whether Stripe or a human last set it, and a
    **live** `MANUAL` `PREMIUM` row is left alone, so access collected in person does not vanish the
    moment a Stripe event touches that member. The column defaults to `MANUAL`, which would have
    relabelled every row Stripe had already written and made that guard protect them from their own
    refunds - so `20260802120000_backfill_entitlement_source` stamps `STRIPE` on the entitlement of
    every user who has a `Subscription` row. That is sound because nothing granted an entitlement by
    hand before this change.
  - `validUntil` is the **furthest** `current_period_end` across the granting subscriptions. A
    subscription Stripe gave no period end for counts as *unknown*, not "never expires", so it can
    never override a sibling that has a real date. `validUntil` stays open only while **every**
    granting subscription lacks a date, and the live status is what holds that case up: a
    `canceled` or `deleted` event drops it to `FREE`.

Refund and chargeback scoping:
- A revocation applies to **exactly one subscription** - the one the charge paid for, resolved
  through charge -> invoice -> subscription. It is never applied customer-wide: checkout reuses a
  returning member's Stripe customer, so a refund of an old charge would otherwise take access from
  the subscription they are paying for right now.
- If the charge cannot be traced to a subscription - it carries no invoice, **or its invoice names
  no subscription** - access is left **unchanged** and an alert fires saying the money went back but
  access was not withdrawn. Guessing is what the scoping rule exists to prevent.
- Two paths read back from the Stripe API, both on the revocation side:
  - `stripe.invoices.retrieve`, to get from a charge to its subscription. `charge.refunded` carries
    `invoice` as a bare id unless expanded, so this runs on **essentially every real refund**. It is
    covered by tests against a stubbed Stripe client, never a live one.
  - `stripe.charges.retrieve`, only when `charge.dispute.created` arrives with an unexpanded charge.
    The expanded fast path is tested; **this fallback is not exercised**, because doing so would
    require a real Stripe call.
- A read that **throws** (429, 5xx, network) is deliberately *not* swallowed: it returns 5xx so
  Stripe retries, exactly as a database failure does. Only a charge that genuinely resolves to no
  subscription takes the leave-access-alone-and-alert path. Treating the two the same is how a
  transient blip would have become a refunded member with permanent access and a `PROCESSED` row.

One checkout at a time (`CheckoutReservation`):
- Checking for an active subscription is a read-then-act test, and two concurrent requests both
  pass it. Measured against a real database before this existed: an **established member with no
  active subscription**, clicking twice at once, opened **two** Stripe checkout sessions and could
  be charged twice. A brand-new member was safe only by accident, via the `User.clerkUserId`
  constraint, and the loser got a 500.
- So a checkout now takes a lock first: a `CheckoutReservation` row with a **unique `userId`**,
  created before the Stripe call. The database picks the winner; the loser gets a clean **409**.
- The lock has three release paths, because no one of them covers everyone:
  - the member returning to `/subscribe/cancel` calls `POST /billing/cancel-checkout`, which frees
    it at once. This is the member who clicks back or Stripe's cancel button, and Stripe emits
    nothing at all for them. That path **reads the session's status at Stripe first**, and then:
    - an **open** session is expired before the lock goes, because dropping the lock alone would
      leave it payable until its own `expires_at` - a member with checkout still open in a second
      tab could then pay twice.
    - a session Stripe reports **complete** *keeps* the lock. The member has already paid, and
      releasing here is the last remaining way two payable sessions can exist: they could press
      Subscribe again before `customer.subscription.created` lands, while the live-subscription
      check still has no row to refuse them on. Nothing real waits on it -
      `checkout.session.completed` frees the same lock moments later.
    - **everything else releases**, including a failed status read or a failed expire. Failures
      release, a confirmed completion holds: no member stays locked out because Stripe was
      unreachable. The status has to be read rather than inferred from a failed expire, which
      reports a non-open session generically and cannot tell *complete* from *expired*.
  - Stripe saying the checkout resolved - `checkout.session.completed`, `.expired`, or
    `.async_payment_failed` - rather than being inferred from subscription rows, because a checkout
    that expired or failed never produces one. **Subscribe to those three events on the Stripe
    webhook endpoint.** This is the member who closes the tab without coming back.
  - the TTL, as the backstop for a process that dies mid-checkout.
- The TTL is 30 minutes (`CHECKOUT_RESERVATION_TTL_MS`), and an expired one is cleared on the
  member's next attempt. The Stripe session is given that same expiry (plus a small allowance, since
  Stripe rejects an `expires_at` under 30 minutes), so `.expired` arrives while the member is still
  trying to pay instead of at Stripe's 24-hour default, and the lock and the session cannot disagree
  about how long a checkout lasts. A failed Stripe call releases it immediately, so a retry is not
  blocked.
- To clear a stuck reservation by hand, delete the member's `CheckoutReservation` row. All of the
  take/release logic lives in `apps/api/src/billing/checkout-reservation.ts`, so a members screen
  can call it later without restating the rules.
- **Design note:** this was the reviewer's proposal, chosen by the owner over a cheaper
  alternative - passing a Stripe `idempotency_key` on `checkout.sessions.create`, which would make
  concurrent duplicates return the same session with no new table or lifecycle. The durable
  reservation was preferred as the more thorough option, knowing it adds a table, a TTL and a
  reconciliation path.

Giving access back:
- A revocation is cleared on exactly two events, and nothing else. A **genuine paid renewal**
  (`current_period_end` moving strictly forward) clears a *refund* revocation; a status of `active`
  is not enough on its own, because `cancel_at_period_end`, a card update and a plan change all
  keep it active.
- `charge.dispute.closed` with status **`won`** clears a *chargeback* revocation, because the money
  stayed with Diaz and the member is a paying customer again. Any other close status leaves the
  revocation standing. Without this a chargeback is a one-way door: the revocation is sticky against
  renewals by design, so a member who disputes and loses would keep paying and never get access
  back.
- Every revocation stores `revokedAt` **and** `revokedReason` together, so a member without access
  can always be shown *why* ("revoked by refund on <date>") rather than an unexplained gap. The
  rules live in one place, `apps/api/src/billing/subscription-revocation.ts`; the Stripe webhook is
  just its first caller.
- A revoke is not a one-way door, but only a **genuine renewal** opens it:
  - Resubscribing always works. A new Stripe subscription id is a new row, which was never revoked.
  - For the same subscription, a **refund** revocation clears only when a later Stripe event moves
    `current_period_end` **strictly forward** - i.e. the member was actually charged again. A live
    status is deliberately *not* enough: `cancel_at_period_end`, a card update and a plan change all
    keep the status `active`, and treating those as proof would let a refunded member press Cancel
    and keep the period they were refunded for.
  - The cost of that strictness is accepted knowingly: a member refunded **by mistake** stays locked
    out until their next renewal unless somebody corrects the record by hand.
  - A **chargeback** revocation is sticky and never clears. The customer forcibly took the money
    back, so they have to subscribe again. A chargeback landing on a subscription already revoked by
    a refund **upgrades** the stored reason, so the sticky outcome cannot inherit the clearable one.
  - Only an event Stripe generated *after* the revocation can clear it. The subscription ordering
    guard alone does not cover this, because a revoke does not advance `lastEventAt`.

Delivery safety:
- Every verified event is recorded in `StripeWebhookEvent` with `PROCESSED` or `FAILED`. That table
  is the answer to "somebody paid and did not get access" - query it rather than the Stripe
  dashboard.
- An event already recorded `PROCESSED` is skipped, so Stripe's redeliveries are safe. A `FAILED`
  one is retried.
- An event Stripe generated *before* the state already recorded on a subscription is ignored, so an
  out-of-order delivery cannot restore access after a cancellation.
- A signature failure returns 400. A verified event that fails to persist returns **5xx**, so Stripe
  retries it instead of dropping it.

Alerting on billing failure (see `apps/api/src/billing/billing-alerter.ts`):
- Every failure logs at `error` level prefixed `BILLING_ALERT`, which any host's log viewer can
  alert on. The alert is raised **before** the `FAILED` row is written and neither step can mask the
  original error, because the usual reason a delivery fails is the database - which is also what
  stops the row being written.
- Alerts also fire for money that moved without access following it: a refund or chargeback whose
  charge genuinely carries no invoice link, and a **live** subscription carrying no `userId`
  metadata (one created in the Stripe dashboard or through a Payment Link). Those are processed,
  not rejected - they may be deliberate - but never silently.
- The unmatched-subscription alert fires **exactly once per subscription**, on the first delivery
  that shows it actually live. It waits for live rather than firing on creation because a card
  needing 3D Secure starts `incomplete` and only turns `active` on a later update - money taken,
  nobody granted access. `StripeWebhookEvent.stripeSubscriptionId` is stamped on the delivery that
  raised the alert, which is what keeps renewals and the eventual cancellation quiet.
- Set the optional `BILLING_ALERT_WEBHOOK_URL` to also POST `{"text": "..."}` to a Slack or Discord
  incoming webhook. Unset means log-only.

Test locally with Stripe CLI:
```bash
stripe listen --forward-to localhost:4000/webhooks/stripe
```

## Video Notes
- Lessons store `muxAssetId` and `muxPlaybackId`.
- API returns `playbackUrl` for clients to treat as an opaque playback source.
- Free lessons use a public playback URL; paid lessons use a signed playback URL.
- **A `PAID` lesson's provider identifiers are withheld from every unauthenticated payload.**
  `/programs`, `/programs/:id` and `/courses/:id` need no authentication, and neither
  identifier is a name for a video, each is the whole address of one: on an asset uploaded
  with a `public` playback policy, `https://stream.mux.com/<id>.m3u8` plays for anyone
  holding it, and a YouTube video id plays at youtube.com for anyone holding it unless that
  video is Private. So `publicVideoIdentifiers` in
  `apps/api/src/content/lesson-presentation.ts` nulls `muxPlaybackId` and `youtubeVideoId`
  together for paid lessons, on both the summary and the detail payload - one rule for every
  provider, so a new one cannot be added past it. The entitlement-gated handles built in
  `mapLessonDetail` are what an entitled member watches with: the signed `playbackUrl` for
  Mux, the `embedUrl` for YouTube. `mapAdminLessonSummary` puts the real ids back for the
  `ADMIN`/`COACH`-guarded admin routes, which is where admins type them in. A `FREE` lesson's
  identifiers stay public on purpose, subject to one limit that applies at every access level:
  `publicVideoIdentifiers` emits only the identifier of the provider the lesson actually
  resolves to, so an id the read path refuses - see "Catalogue Video States" above - is never
  handed out, and neither is an id belonging to a provider the lesson does not play on.
  Withholding the id on the detail payload is also what keeps signed playback working:
  measured against `@mux/mux-player` 3.11.4 in Chrome, a player handed both a `playbackId`
  and a signed `src` requests `stream.mux.com/<id>.m3u8?redundant_streams=true` and drops
  the token entirely. The web player passes the id only when `src` carries no token for it
  to drop, and the mobile player prefers `playbackUrl`, but they deploy separately from the
  API, so neither substitutes for withholding the id.
- `POST /webhooks/mux` verifies the `mux-signature` HMAC (rejecting timestamps older than
  300s) and, on `video.asset.ready`, writes `muxPlaybackId`, `durationSeconds` and
  `videoProvider` onto the lesson whose `muxAssetId` matches. Set `muxAssetId` in the admin
  lesson editor to opt a lesson into that sync. `videoProvider` is written too because a lesson
  can be saved holding the asset id alone, and a playback id on a row no read path treats as
  Mux is the same dead end as no id at all. Every field is written only where it would actually
  change the row, so a redelivery is a no-op rather than a write landing on the values already
  there.
  The sync **refuses** a lesson that still holds a `youtubeVideoId`: one lesson cannot be served
  by two providers, and completing it would violate `lesson_video_provider_consistency_chk` and
  turn every redelivery into an opaque 500. It logs the reason and throws, so it shows up as a
  failed delivery in the Mux dashboard next to the asset. To recover, change the lesson's video
  source to Mux in the lesson editor - that is what clears the YouTube video ID while keeping the
  asset ID, and deleting the ID by hand is a save the editor refuses - then redeliver the event.
  A lesson holding the asset id with no playback id yet is the **waiting-for-Mux** state - see
  "Catalogue Video States" above. It is normal: Mux issues the playback id later. It is also
  where a lesson lands when `video.asset.ready` was delivered *before* the asset id was pasted
  into the editor, which is the likely order since uploads happen in the Mux dashboard. The
  handler answers 201 for an asset no lesson matches (assets exist in the account this app never
  created, and throwing would make Mux retry forever), so that event is gone. The remedy, named
  on both admin surfaces, is to redeliver `video.asset.ready` from the Mux dashboard once the
  lesson holds the asset ID. Nothing re-reconciles automatically on purpose; resolving the asset
  from Mux at save time is separately tracked.
  For a `PAID` lesson the asset must be **signed-only**: the sync refuses an asset that
  carries no `signed` playback id, and equally refuses one that carries a `public` playback
  id even when a signed id sits beside it, because nothing stops a caller using the public
  one. The refusal logs an error and throws, so the delivery fails visibly in the Mux
  dashboard next to the asset whose upload policy is wrong rather than quietly attaching a
  public id to a paid video, and Mux redelivers once a signed-only asset replaces it. A
  `FREE` lesson takes the asset's `public` id and is refused the same way when the asset
  carries none: a free lesson is served over a plain `stream.mux.com` url, so an id with any
  other policy would be stored and then silently fail to play. Either way the stored id
  comes from the policy the access level requires, never from whichever id arrived first.
- Signed playback needs a Mux *signing key* (`MUX_SIGNING_KEY_ID` /
  `MUX_SIGNING_KEY_PRIVATE`), which is a different credential from the `MUX_TOKEN_ID` /
  `MUX_TOKEN_SECRET` API access token.
- What none of this fixes: an asset already uploaded to Mux with a `public` playback policy
  stays public, and no code change retracts a playback id that has already been served. Both
  are Mux dashboard work for the account owner. Two cases to audit, not one:
  - every asset backing a lesson that is `PAID` today, and
  - every asset backing a lesson that was `FREE` and later flipped to `PAID`. The admin
    editor's `updateLesson` (`apps/api/src/admin/admin.service.ts`) changes `accessLevel`
    while the row keeps its existing `muxPlaybackId`. From then on the API withholds that id
    and mints signed URLs, but it was already served to every anonymous `/programs` caller
    while the lesson was free, so anyone who read the catalogue earlier still holds a
    working, non-expiring `stream.mux.com` URL against a public-policy asset. Closing that
    needs the asset rotated or re-created in Mux; it is filed as separate work and is
    deliberately not mitigated in code, because a half-measure here would only look handled.

  A `PAID` lesson hosted on YouTube needs the same audit in YouTube Studio, for the same
  reason: its video id was served anonymously too, and the video plays for anyone holding
  that id unless it is set to **Private**. Unlisted is not retracted.

Test webhooks locally with the Mux CLI - it forwards to localhost and prints a signing
secret to use as `MUX_WEBHOOK_SECRET`:
```bash
mux webhooks listen --forward-to http://localhost:4000/webhooks/mux
mux webhooks trigger video.asset.ready --forward-to http://localhost:4000/webhooks/mux
```

## Next.js Version Floor

`apps/diaz-ondemand-web` pins `next` exactly. `AGENTS.md` carries the rule; this section carries
the evidence, so the next person moving the pin can re-derive it instead of guessing. **Current
pin: 15.2.9.**

### Why 15.2.9, and not lower

The safe version is the intersection of five constraints, not the newest release. Each floor is
the lowest version that satisfies that one constraint on the 15.2 line.

| Constraint | Floor | Why it binds |
| --- | --- | --- |
| CVE-2025-66478 / GHSA-9qr9-h5gf-34mp - React2Shell, critical, CVSS 10.0, RCE in the RSC flight protocol | 15.2.6 | Vercel fails the build outright: "Vulnerable version of Next.js detected". This is the only advisory the deploy gate is keyed to. |
| CVE-2025-55183 (source code exposure) and CVE-2025-55184 (DoS), plus the incomplete-fix CVE-2025-67779 / GHSA-5j59-xgg2-r9c4 | 15.2.8 | The 2025-12-11 follow-ups. npm security-deprecates 15.2.6 and 15.2.7 for these, so a version that clears React2Shell can still be deprecated. |
| GHSA-h25m-26qc-wcjf - high, App Router RSC request-deserialization DoS | 15.2.9 | The only one of the five that 15.2.8 does not satisfy, and therefore the reason the pin is 15.2.9. |
| CVE-2025-29927 - `x-middleware-subrequest` authorization bypass | 15.2.3 | `middleware.ts` is the app's only authorization boundary. Vercel-hosted deployments were architecturally not exploitable, because Vercel runs routing out of process, but the floor still holds for `next start` and local runs. |
| `@clerk/nextjs` 6.37.5 peer range on `next` | 15.2.3 | `^13.5.7 || ^14.2.25 || ^15.2.3 || ^16`. The previous pin, 15.1.7, did not satisfy it. |

### What is still open at 15.2.9, and under what conditions

None of these has a fix inside the 15.2 line, so none is closable without a minor upgrade. They
are recorded with the condition each one needs, because "affected by version range" and
"reachable in this app" are different questions.

- **GHSA-p9j2-gv94-2wf4 / CVE-2026-64645** - high, SSRF via `rewrites()` with an
  attacker-controlled destination hostname. Fixed in 15.5.21 / 16.2.11. **Not reachable here.**
  The advisory needs a `rewrites()` or `redirects()` rule that interpolates a dynamic segment
  into an *external* destination hostname (`destination: 'https://:tenant.api.example.com'`).
  `apps/diaz-ondemand-web/next.config.ts` declares neither, and is the repo's only Next config.
  The repo's single `rewrites` entry is `apps/api/vercel.json` (`/(.*)` to `/api`) - a Vercel
  platform rewrite in a different app, with a relative destination and no hostname to make
  dynamic. The web app makes exactly one server-side request, `lib/api-shared.ts`
  (a single `fetch()` over `apiBaseUrl` plus a path), whose host is `NEXT_PUBLIC_API_URL` from the
  environment and never from the request; nothing reads `headers()`, `host` or
  `x-forwarded-host` to build a URL.
  The `Response.redirect(req.nextUrl.clone())` in `middleware.ts` looks similar and is not the
  same shape: no destination template, no external host, and `pathname`/`search` overwritten with
  constants. Measured - a poisoned `Host:` or `X-Forwarded-Host:` still yields the server's own
  origin.
- **GHSA-2xp9-vwfh-vxw4** - critical, unauthenticated RCE in the Image Optimization API via
  libheif/`sharp` when Next optimizes an attacker-controlled AVIF. Fixed in 15.5.24 / 16.3.3,
  which is outside the 15.2 line. **Not reachable here, and for exactly one reason** - stated
  that way because there is no second one to fall back on. That reason has two halves and needs
  both. The optimizer's allowlist is empty: `apps/diaz-ondemand-web/next.config.ts` sets no
  `images` config, so `remotePatterns` and `domains` both keep their `[]` defaults, which
  confines `/_next/image?url=` to same-origin paths. And the origin serves nothing an attacker
  can control the bytes of: no `public/` directory, no route handlers (no `route.ts` anywhere
  under `app/`), no server actions, no upload surface. The allowlist keeps the optimizer on the
  origin; the bare origin is what leaves it nothing to fetch. Neither half holds alone.
  So this re-opens at 15.2.9 the moment either half goes - one `remotePatterns` or `domains`
  entry (Mux thumbnails, an avatar CDN), or any same-origin route that serves user-supplied
  image bytes. Re-read this bullet before changing image configuration or adding a route handler.
  Two things that read like reasons and gate nothing, recorded so they are not counted as margin:
  that the app imports `next/image` nowhere is irrelevant, because the Next server serves
  `/_next/image` whether or not any component imports it; and the default
  `formats: ["image/webp"]` is irrelevant, because `images.formats` selects the *output* encoding
  negotiated through the `Accept` header, while the advisory fires on *decoding* an
  attacker-supplied AVIF *input*.
- **CVE-2026-75604 / GHSA-p293-qw3h-jr36** - critical, unauthenticated RCE on Windows-hosted
  servers. Fixed in 15.5.24 / 16.3.3. **Not applicable.** The advisory states Linux and macOS are
  unaffected; this deploys to Vercel.
- The rest of the advisory-database set against 15.2.9 - nine further high, fourteen moderate
  and two low - all needing 15.5.16+ or 16.x. The two criticals above are not in that set;
  they were still repository-only advisories when this was measured, which is the point of
  checking more than `pnpm audit`.

### The 15.2 line is end-of-life

Next.js supports 16.3 (Active LTS) and 15.5 (Maintenance LTS). 15.2 receives no further security
patches, so this pin is a stopgap that clears the deploy block, not a resting place. Moving to
15.5.x is a minor upgrade and a separate decision - it re-opens Clerk peer compatibility and the
middleware/route behaviour checks below.

### Checking a candidate version

A clean `pnpm audit` is necessary and not sufficient. Vercel publishes some advisories to the
vercel/next.js repository before OSV and the GitHub advisory database ingest them, so all three
were measured for this pin and all three are needed:

```bash
pnpm audit                                   # GitHub advisory database, via the lockfile
npm view next@<candidate> deprecated         # names the advisory blog for a superseded release
curl -s -X POST https://api.osv.dev/v1/query \
  -d '{"package":{"name":"next","ecosystem":"npm"},"version":"<candidate>"}'
```

Then read the security posts on nextjs.org/blog for anything newer than the databases carry, and
confirm the `@clerk/nextjs` peer range still admits the candidate (`pnpm install` reports an unmet
`next` peer when it does not).

After changing the pin, re-verify what the bump could silently break: the route set and its
static/dynamic classification, the middleware response matrix (coming-soon on, Clerk configured,
Clerk unconfigured), that `/account`, `/favorites`, `/subscribe` and `/admin` still gate while
everything else stays permitted, and that the Clerk catch-all check in
[Clerk Setup Notes](#clerk-setup-notes-web--expo) still answers 200.

## Vercel Deployment Notes
- Web app deploy: set Vercel project root to `apps/diaz-ondemand-web`.
- API deploy: its own Vercel project, rooted at `apps/api`, running as serverless functions.
  Step-by-step in [API Deploy Runbook (Vercel serverless)](#api-deploy-runbook-vercel-serverless)
  below. `pnpm start` still runs the same application as a long-running server and is what
  local and any non-Vercel host use.
- Pre-deploy checklist. The API **exits instead of starting** if any of these is missing:
  - `DIAZ_INTERNAL_API_KEY` - always.
  - `MUX_WEBHOOK_SECRET` - always, with no "is Mux enabled" condition attached.
  - The signing key pair `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` - always,
    unconditionally, with no "is Mux enabled" condition attached.
  - `STRIPE_WEBHOOK_SECRET` - when Stripe is enabled (`STRIPE_SECRET_KEY` set).

  "Deployment" means the same thing for all four: `NODE_ENV=production` **or** a
  `DATABASE_URL` that is not loopback. They ask one predicate, `isDeployment` in
  `apps/api/src/config/env.ts`, so they cannot disagree. `NODE_ENV` alone was never enough -
  `pnpm start` is the only thing in this repository that sets it, so a run started as
  `node dist/main.js`, a Dockerfile `CMD` or a Procfile left every `NODE_ENV === 'production'`
  check inert. Measured against the built API with `NODE_ENV` never set and a non-loopback
  `DATABASE_URL`: it booted, answered `/health` with 200, and rejected every Mux delivery,
  every Stripe delivery and every internal entitlement lookup. It now exits without opening a
  port, and each refusal names the variable and what breaks without it.

  `MUX_WEBHOOK_SECRET` used to carry an `MUX_TOKEN_ID` condition. That drifted, for the same
  reason the signing-key rule's did: `MUX_TOKEN_ID` is read only by the env schema's own
  pairing rule with `MUX_TOKEN_SECRET`, never by a serving path, so it is not a reliable
  signal that Mux webhooks are wired, and a deployment serving Mux video without ever setting
  it skipped the check. The condition is gone rather than replaced - a deployment cannot
  ingest a Mux asset without this secret, so there is no configuration in which requiring it
  is wrong. `STRIPE_SECRET_KEY` stays as a condition on `STRIPE_WEBHOOK_SECRET` because it
  cannot drift the same way: it is exactly what `BillingService` and `WebhooksService`
  construct the Stripe client from.

  This refusal is deliberate. The webhook and internal-API paths already fail closed at
  request time - `verifyStripeSignature`/`verifyMuxSignature` throw when the secret is
  absent, and `GET /users/:clerkUserId/entitlements` rejects every caller when
  `DIAZ_INTERNAL_API_KEY` is unset. For those, booting without the value is not an
  exposure; it is a service that cannot do its job, silently, until someone notices.
  Refusing at startup makes that visible immediately.

  The Mux signing keys are the other kind. Without them a `PAID` lesson has no signed URL to
  serve, so the request-time half decides what happens next - and it is keyed on the same
  fact as the startup check, not on `NODE_ENV`: `isUnsignedPaidPlaybackAllowed` in
  `apps/api/src/config/env.ts` allows the unsigned fallback only against a loopback
  `DATABASE_URL`, the same predicate the dev auth bypass uses and for the same reason. On a
  deployed database, paid lesson detail answers 500 rather than handing out an unsigned,
  non-expiring `stream.mux.com` URL - however the process was started, and whatever
  `NODE_ENV` says. On a developer's localhost database the fallback still works.
  Two halves of one rule: a deployment cannot boot without the keys, and if it somehow runs
  without them it refuses to serve rather than serving a paid video unsigned.

  What this does **not** do: it does not make paid video safe on its own. Every existing Mux
  asset still carries whatever playback policy it was created with, and a playback id that
  has already been served cannot be retracted. See the audit list at the end of "Video Notes" -
  that part is the account owner's job in the Mux dashboard.
- **Before this change deploys, confirm three values on the host**, not one. Three startup
  checks widened from `NODE_ENV === 'production'` to `isDeployment`, so any of them can now
  refuse a deployment that booted yesterday: `DIAZ_INTERNAL_API_KEY`, `MUX_WEBHOOK_SECRET`,
  and `STRIPE_WEBHOOK_SECRET` when `STRIPE_SECRET_KEY` is set. Confirm all three are present
  on the API host before deploying.

  Assume all three are new refusals there. Two of them are unconditional on any deployment;
  `STRIPE_WEBHOOK_SECRET` is required only where `STRIPE_SECRET_KEY` is set, which on this
  product it is, because Stripe billing is live. Assume the worse case because this
  repository holds two records that contradict each other and cannot settle which one
  describes the live service. This repository used to record the API as started by
  `pnpm start`, which sets `NODE_ENV=production` itself; on that reading two of the three
  already fired and the only new refusal is `MUX_WEBHOOK_SECRET`, which additionally dropped
  its `MUX_TOKEN_ID` condition. The `DEV_BYPASS_AUTH` entry under "Security Invariants" in
  `AGENTS.md` records the opposite as observed fact: on 2026-08-02 the project owner
  confirmed the deployed API running with `NODE_ENV=development`, and a run that went through
  `pnpm start` cannot carry that value. If that is still how it starts, its `DATABASE_URL` is
  not loopback, `isDeployment` is therefore true, and the widened checks are live on that
  deployment for the first time: `MUX_WEBHOOK_SECRET` and `DIAZ_INTERNAL_API_KEY`
  unconditionally, and `STRIPE_WEBHOOK_SECRET` wherever `STRIPE_SECRET_KEY` is set. Only the
  host can say which record is current. On the Vercel API project the question does not
  arise: nothing there runs `pnpm start` and step 3 of the runbook says not to set `NODE_ENV`
  at all, so `isDeployment` is true through the non-loopback `DATABASE_URL` and all three are
  live from the first deploy.

  This is written for the worse case on purpose, because the costs are not symmetric.
  Overstating it costs three environment-variable checks. Understating it means an API that
  refuses to boot after a deploy, with nothing said beforehand. The answer is confirming the
  values on the host, never relaxing a check to get the deploy green.
- Prefer real host environment variables for those production values, with the monorepo-root
  `.env` as the local fallback. That is ordinary good practice for a deployed service, not a
  workaround for a load-ordering bug. `apps/api/.env` is **not** a blind spot: `app.module.ts`
  calls `ConfigModule.forRoot` inside its `@Module({ ... })` decorator argument, which is
  evaluated when `create-app.ts` statically imports `AppModule`, and `forRoot` writes the
  working-directory `.env` into `process.env` synchronously - both before `createApiApp()`
  calls `validateApiEnv`. That holds for either entrypoint, since both reach `AppModule`
  through `create-app.ts`. So values placed in `apps/api/.env` **are** seen by startup
  validation.
  That is also why the dev-bypass startup refusal fires for a `DEV_BYPASS_AUTH=true` that
  arrives from `apps/api/.env`, not only for one exported by the host.
- Web project environment: `NEXT_PUBLIC_API_URL` pointing at the deployed API, plus **both**
  Clerk keys - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`. The secret key is
  required there because `clerkMiddleware` asserts it before any handler runs, the same reason
  it is needed locally (see "Local Setup" above); a web environment without it serves
  `Missing secretKey` on every route.
- Keep the API-only secrets - `DATABASE_URL`, `STRIPE_SECRET_KEY`, the Mux credentials and
  `DIAZ_INTERNAL_API_KEY` - on the API environment only. None of them belong on the web project.
- While Diaz on Demand is not launched, set `VOD_COMING_SOON=true` and
  `NEXT_PUBLIC_VOD_COMING_SOON=true` on production web/API deployments. Leave both unset or
  `false` for local and preview deployments so development routes stay usable.

## API Deploy Runbook (Vercel serverless)

No Vercel project exists and no live URL is recorded in this repository. Nothing below has run
against a real Vercel project - see "What is proven, and what is not" at the end of this
section before trusting any of it.

**Decision, 2026-09-01 (project owner): two Vercel projects.** The API is its own project rooted
at `apps/api`, alongside the existing web project. Folding the API into the web project so it
served under `/api/*` on the same domain was offered and declined, because it couples them: a
broken web build would take webhook delivery down with it, and webhook delivery is the whole
reason the API is being deployed. Do not revisit this without that reason in hand.

### How it runs

`apps/api` is the same NestJS application either way. What changes is who starts it:

- `pnpm start` builds nothing new and runs `dist/main.js`, which calls `app.listen(PORT)`.
- Vercel imports `apps/api/api/index.js`, which re-exports `dist/serverless.js`, which calls
  `app.init()` and exports the underlying Express instance. `apps/api/vercel.json` rewrites every
  path to that one function, so `/health`, `/programs` and `/webhooks/*` all reach the same
  router they do locally.

Both entrypoints build the application through `createApiApp` in `src/create-app.ts` - CORS, the
coming-soon wall, the global validation pipe, Swagger - so routes and behaviour cannot drift
between them. Three details there are load-bearing and should not be "tidied":

- `api/index.js` is hand-written JavaScript that only forwards to `dist/`. Vercel compiles a
  function entrypoint with esbuild, and esbuild cannot emit the decorator metadata Nest's
  dependency injection reads, so nothing Nest has to understand may go through it. `nest build`
  (tsc) produces `dist/`; the entrypoint just points at it.
- `dist/serverless.js` exports the Express instance, not an `(req, res)` wrapper. Vercel skips
  its request helpers for a listener that has a `listen` method, which keeps the request stream
  unread so webhook signatures verify against the real bytes.
- `restoreReadableBody` (`src/serverless-raw-body.ts`) is the backstop for when that does not
  happen. If the runtime reads the body first, `req.readable` goes false, `on-finished` reports
  the request finished, body-parser returns without calling the `verify` callback that sets
  `rawBody`, and **every webhook answers 400**. It is registered only by the serverless
  entrypoint and returns immediately when the stream is untouched.

### 1. Create the project

- New Vercel project from this repository, separate from the web one.
- **Root Directory: `apps/api`.** Leave "Include source files outside of the Root Directory in
  the Build Step" enabled - the install has to happen at the workspace root or `@diaz/shared`
  and `@diaz/db` will not resolve.
- **Framework Preset: Other.** `apps/api/vercel.json` already sets the build command
  (`pnpm exec turbo run build --filter=api`, which also runs `prisma generate` via `@diaz/db`),
  the output directory (`public`) and the catch-all rewrite. Do not also set them in the
  dashboard; the dashboard wins and they will disagree.
- **`apps/api/public/` is empty on purpose, and `outputDirectory` points at it.** With no output
  directory set and no `public/` directory present, Vercel's documented fallback is to serve the
  Root Directory itself as static output, and static files are matched before `rewrites`. That
  would publish `apps/api/src/**`, `dist/**`, `tsconfig.json` and `package.json` on the API's
  public domain. It is source disclosure, not a breach and not a secret leak: `.env` is
  gitignored, only `.env.example` is committed and it carries placeholders, and no API route
  collides with those filenames, so routes and webhook delivery are unaffected either way.
  Whether that fallback actually applies to this project is unverified - it cannot be measured
  from this repository, and nobody has been able to test it without the Vercel account - so an
  empty static root is cheap insurance: it costs nothing, changes no request behaviour, and is
  correct whether the fallback applies or not. Keep the `.gitkeep` that holds the directory in
  git. Not a `.vercelignore`: that also removes files from the build source, and the build needs
  `src/`. Step 7 checks the deployed answer; the mitigation and the check are belt and braces,
  not alternatives.
- Leave the Install Command on its default. If the build cannot find the workspace packages,
  that is the setting to look at first.
- Node.js version 22.x, to match local.
- **Region: the same one as the database.** Every request opens or borrows a database
  connection; a function in `iad1` talking to a database in Frankfurt pays that latency twice on
  every call.

### 2. Database: use the pooled connection string

This is the one setting that will not announce itself when it is wrong. Each function instance
runs its own Prisma client with its own connection pool, and instances come and go with traffic.

Measured locally against Postgres 17, on this repository's own code:

| Configuration | Instances | Postgres backends |
| --- | --- | --- |
| Direct URL, no `connection_limit` | 1 | **21** (`cpus x 2 + 1`) |
| PgBouncer, `?pgbouncer=true&connection_limit=1` | 3 (90 concurrent requests) | **3** |

So `DATABASE_URL` on the Vercel project must be the **pooled** endpoint, with both parameters:

```
postgresql://USER:PASSWORD@POOLED-HOST:PORT/DB?schema=public&pgbouncer=true&connection_limit=1
```

- Supabase: the pooler host on port `6543` (transaction mode), not `5432`.
- Neon: the `-pooler` hostname.
- Anything else: PgBouncer or RDS Proxy in transaction pooling mode.

`connection_limit=1` caps each instance; the pooler is what stops the number of instances from
becoming the number of database connections. Neither alone is enough. No application code
depends on this - it is entirely the connection string.

**Migrations do not go through the pooler.** Run them yourself, before the deploy, against the
direct `5432` endpoint:

```bash
DATABASE_URL='postgresql://USER:PASSWORD@DIRECT-HOST:5432/DB?schema=public' \
  pnpm --filter @diaz/db exec prisma migrate deploy --schema prisma/schema.prisma
```

### 3. Environment variables

Set these on the API project (Production, and Preview if you use it). The API **refuses to
start** without the first group, and names the one it is missing in the build log - see the
pre-deploy checklist above for why each exists.

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | The pooled URL from step 2. |
| `DIAZ_INTERNAL_API_KEY` | Required on any deployment. |
| `MUX_WEBHOOK_SECRET` | Required on any deployment. From the Mux webhook you create in step 6. |
| `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_KEY_PRIVATE` | Required on any deployment, as a pair. |
| `STRIPE_WEBHOOK_SECRET` | Required whenever `STRIPE_SECRET_KEY` is set, which it is. |
| `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER` | Required whenever `DEV_BYPASS_AUTH` is false. |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_MONTHLY` | Billing is live, so both. |
| `CORS_ORIGIN` | See step 4. |
| `WEB_APP_URL` | Where Stripe checkout returns the member to. |
| `VOD_COMING_SOON` | `true` on production until launch. |
| `DEV_BYPASS_AUTH` | `false`. It cannot be anything else against a non-loopback database. |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Only as a pair, or not at all. |

Do not set `NODE_ENV`. Every deployment check keys on `isDeployment`, which is already true
because `DATABASE_URL` is not loopback.

### 4. CORS - the most likely first failure

`CORS_ORIGIN` is a comma-separated list, matched exactly. It must contain the web project's
origin, scheme included and with no trailing slash:

```
CORS_ORIGIN=https://your-web-domain.com,https://www.your-web-domain.com
```

Getting this wrong is invisible from the API side - `curl` keeps working, `/health` is green,
and only a browser fails, in the console rather than on the page. If the web app suddenly cannot
reach the API after a deploy, check this before anything else. Add the Vercel preview domain too
if you test against previews. The Expo app is not a browser and is unaffected.

### 5. Point the clients at the new URL

- Web project: `NEXT_PUBLIC_API_URL` = the API project's URL.
- Mobile: `EXPO_PUBLIC_API_URL` = the same URL. **This one is baked into the built app.**
  Changing it later means rebuilding and redistributing the mobile app, so choose a URL you
  intend to keep - a custom domain on the API project rather than a generated `*.vercel.app`
  hostname.

### 6. Wire the webhooks

- Mux: Settings > Webhooks, new webhook to `https://YOUR-API/webhooks/mux`. Copy the signing
  secret into `MUX_WEBHOOK_SECRET` and redeploy.
- Stripe: Developers > Webhooks, new endpoint at `https://YOUR-API/webhooks/stripe`. Copy the
  signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy. Events are listed under
  "Stripe + Webhooks" above.

Both secrets are read at request time, but the API refuses to boot without them, so set them
before the first deploy or expect the first one to fail loudly.

### 7. After deploying, confirm it actually works

In order, because each step rules out the next one's causes:

```bash
# 1. The function boots and routing reaches Nest. Answers even behind the coming-soon wall.
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-API/health            # 200

# 2. The wall is up (production only).
curl -s https://YOUR-API/programs                                            # coming soon 503

# 3. Webhook routes exist, and the secrets are loaded. A deliberately wrong signature
#    must be REJECTED - a 404 means routing, a 500 means the secret is missing.
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://YOUR-API/webhooks/mux \
  -H 'content-type: application/json' -H 'mux-signature: t=1,v1=deadbeef' -d '{}'   # 400
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://YOUR-API/webhooks/stripe \
  -H 'content-type: application/json' -H 'stripe-signature: t=1,v1=deadbeef' -d '{}' # 400

# 4. The project root is not being served as static output. Any non-200 passes - it means
#    the path reached Nest rather than matching a file. 503 is the coming-soon wall
#    (production, while VOD_COMING_SOON=true), 404 once the wall is off. A 200 is the failure.
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-API/package.json    # 503, or 404
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-API/tsconfig.json   # 503, or 404
```

A 200 on either of those, carrying the file's actual contents, is the only failing outcome, and
it means Vercel is serving the project root as static output after all - publishing this app's
TypeScript source on a public domain. That is source disclosure rather than a breach: no secrets
are involved, since `.env` is gitignored and only `.env.example` is committed with placeholders,
and no API route collides with those filenames, so routes and webhook delivery are unaffected
either way. The empty `public/` directory from step 1 is meant to prevent it and is unverified,
so the two stand together as belt and braces rather than as alternatives - tell the owner the
moment a 200 comes back rather than eventually.

Then the part that actually matters, which `curl` cannot do because you cannot forge a
signature:

5. **Mux**: in the Mux dashboard, redeliver a `video.asset.ready` event to the new webhook (or
   upload a short test asset). The delivery must show **201** in Mux's own webhook log - neither
   handler sets `@HttpCode`, so Nest answers a POST with 201, not 200. A 400 there means the
   signature did not verify - `MUX_WEBHOOK_SECRET` does not match the webhook you copied it
   from. A 500 means it verified and then something failed server-side; the reason is in the
   Vercel function logs.
6. **Stripe**: `stripe trigger checkout.session.completed` with the CLI pointed at the deployed
   endpoint, or "Resend" an existing event from the dashboard. Same rule: 201 in Stripe's own
   log, not just a 201 from `curl`.
7. **Confirm a row changed.** A 201 only says the request was accepted. For Mux, the lesson
   matching the asset should now hold the playback id the event carried.

Read the Vercel function logs alongside all of this. Startup refusals name the missing variable
verbatim.

### Troubleshooting

- **Every webhook answers 400 "Missing signature or raw body".** The runtime read the request
  body before Express and did not replay it, so the signed bytes are gone.
  `restoreReadableBody` covers the replayed case; if this still happens, set `NODEJS_HELPERS=0`
  as a project environment variable, which turns Vercel's request helpers off at build time.
- **Build fails resolving `@diaz/shared` or `@diaz/db`.** The install did not run at the
  workspace root - check "Include source files outside of the Root Directory".
- **Runtime error about the Prisma query engine.** `prisma generate` runs during the Vercel
  build, on the same platform the function runs on, so the right engine should be produced and
  traced. If it is not, add `binaryTargets = ["native", "rhel-openssl-3.0.x"]` to the `generator
  client` block in `packages/db/prisma/schema.prisma`.
- **Cold starts time out.** Nest initialises the whole application on the first request to a new
  instance. Raise the function's max duration.

### What is proven, and what is not

Everything below was measured on this branch, against the built API, driven through a local
stand-in for Vercel's launcher transcribed from `@vercel/node`'s own source, with `NODE_ENV`
unset throughout and a non-loopback `DATABASE_URL` so every deployment check was live.

**Proven locally:**

- Nest boots inside the function entrypoint and maps every route.
- A signed Mux `video.asset.ready` round trip returns 201 and writes the playback id and
  duration to the lesson row; a signed Stripe event returns 201; a tampered signature is
  rejected with 400. All of it holds both when the runtime leaves the body stream alone and when
  it reads it first.
- Pooled connections behave as the table in step 2 says.
- Startup validation survives the conversion: a missing `MUX_WEBHOOK_SECRET`,
  `DIAZ_INTERNAL_API_KEY` or Mux signing key, or `DEV_BYPASS_AUTH=true` against a non-loopback
  database, makes the module fail to load with the same named error, and no request is served.
- `pnpm dev` and `pnpm start` are unchanged and still serve.
- Swagger at `/docs` renders and `/docs-json` returns the spec.

**Not proven, because it needs the Vercel account:**

- That a real deployment builds, boots and serves at all. Nothing here has run on Vercel.
- Whether Vercel's production launcher skips its request helpers the way its dev server does.
  The `restoreReadableBody` middleware exists so the answer does not matter, and both answers
  were tested locally - but which one is live is unverified.
- Cold start duration, and whether the plan's default function timeout accommodates it.
- Whether Vercel would have served the Root Directory as static output with no `outputDirectory`
  set. `outputDirectory` now points at an empty committed `public/`, which settles it either way,
  but the fallback itself has never been observed on this project. Step 7's `/package.json` and
  `/tsconfig.json` checks are what confirm it on the real deployment.
- **Swagger UI's static assets.** Run against `@vercel/nft` 1.10.0 - the tracer Vercel uses -
  `swagger-ui-dist` contributes only `absolute-path.js` and `package.json` to the traced file
  list; `swagger-ui.css` and `swagger-ui-bundle.js` are resolved at runtime and are not
  followed. Expect `/docs` to return its HTML and then fail to style or script itself. The
  OpenAPI document at `/docs-json` is generated in-process and is unaffected, so point any
  Swagger viewer at that. This is not worked around in code, because the fix is an
  `includeFiles` glob into a pnpm store path that cannot be verified without deploying.

## Scripts
- `pnpm dev` -> API + web
- `pnpm dev:mobile` -> Expo mobile
- `pnpm start` -> built API as a long-running server, with `NODE_ENV=production`. Not what
  Vercel runs - see [API Deploy Runbook](#api-deploy-runbook-vercel-serverless).
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (see [Tests](#tests))
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:seed`

## Tests

`pnpm test` runs everything. Most of the API suite mocks Prisma. Two suites deliberately do not,
because what they cover is invisible to a mocked client:

- `apps/api/src/tests/billing-lifecycle.db.test.ts` - the resubscribe and double-subscription
  defects were unique-constraint violations that a mocked client cannot raise.
- `apps/api/src/tests/mux-ingestion.db.test.ts` - the state "uploaded, still encoding" was
  refused by a CHECK constraint, `lesson_video_provider_consistency_chk`, which Prisma does not
  model and mocks do not enforce. Against the mocks the ingestion chain looked like it worked
  while every real save answered 500.

Both run the real services against a real Postgres, and both have the same contract: they
**skip** unless `TEST_DATABASE_URL` is set, so `pnpm test` still works with no database
around - except on CI, where a missing `TEST_DATABASE_URL` fails the run rather than silently
dropping the coverage. CI provides a Postgres service container.

To run them locally, using the same digest-pinned image CI runs:

```bash
docker run -d --name diaz-test-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=diaz \
  -p 55433:5432 postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
DATABASE_URL='postgresql://postgres:postgres@localhost:55433/diaz?schema=public' \
  pnpm --filter @diaz/db exec prisma migrate deploy --schema prisma/schema.prisma
TEST_DATABASE_URL='postgresql://postgres:postgres@localhost:55433/diaz?schema=public' pnpm test
```

## MVP TODO / Roadmap
- Better admin UX for content ordering and bulk operations
- Offline-safe mobile progress queueing
- CI pipeline for lint/typecheck/test + deploy previews

## Entitlements Endpoints

### GET /me/entitlements (Clerk-authenticated)
Returns current user entitlements using Clerk auth (or `DEV_BYPASS_AUTH=true` in local dev).

Example response:
```json
{
  "gymMember": true,
  "vod": true,
  "tier": "VOD",
  "validUntil": "2026-12-31T23:59:59.000Z"
}
```

MVP truth mapping:
- `gymMember`: true if a `User` row exists (endpoint upserts user on first request)
- `vod`: true when `Entitlement.tier === PREMIUM` and `validUntil` is null or in the future
- `tier`: `VOD` if `vod=true`, else `GYM_MEMBER` if `gymMember=true`, else `FREE`

### GET /users/:clerkUserId/entitlements (Server-to-server)
Internal endpoint for external website redirect logic.
Not for browser/client use - server-to-server only.

Security:
- Requires header `x-diaz-api-key`
- Must match API env var `DIAZ_INTERNAL_API_KEY`
- Returns `401` if missing/invalid

Example:
```bash
curl -H "x-diaz-api-key: $DIAZ_INTERNAL_API_KEY" \
  http://localhost:4000/users/user_123/entitlements
```
