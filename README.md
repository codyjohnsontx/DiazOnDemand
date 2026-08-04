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

Mux (optional now):
- `MUX_TOKEN_ID` / `MUX_TOKEN_SECRET` (API access token, from Settings > Access Tokens)
- `MUX_WEBHOOK_SECRET` (webhook signing secret; required in production when `MUX_TOKEN_ID` is set)
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
the API loads the monorepo-root `.env` (see `apps/api/src/main.ts`), Next.js loads
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
exist". They are cleared, and the API will no longer resolve an identifier that is not
shaped like one the provider issues - see `isValidMuxPlaybackId` in `packages/shared` and
`resolveVideoProvider` in `apps/api/src/content/lesson-presentation.ts`. Members get the
not-yet-filmed state instead of a broken player; staff still see the stored value in the
lesson editor, now with a non-blocking hint next to any identifier the read path will refuse,
in the editor and on the admin course lesson rows. A not-yet-filmed lesson also shows no
runtime to a member - the seeded `durationSeconds` stays as a planned length and still counts
towards course totals. Whether unfilmed lessons stay published is an open product decision.

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
  `ADMIN`/`COACH`-guarded admin routes, which is where admins type them in. Free lessons are
  unchanged - their identifiers are public on purpose.
  Withholding the id on the detail payload is also what keeps signed playback working:
  measured against `@mux/mux-player` 3.11.4 in Chrome, a player handed both a `playbackId`
  and a signed `src` requests `stream.mux.com/<id>.m3u8?redundant_streams=true` and drops
  the token entirely. The web player passes the id only when `src` carries no token for it
  to drop, and the mobile player prefers `playbackUrl`, but they deploy separately from the
  API, so neither substitutes for withholding the id.
- `POST /webhooks/mux` verifies the `mux-signature` HMAC (rejecting timestamps older than
  300s) and, on `video.asset.ready`, writes `muxPlaybackId` and `durationSeconds` onto the
  lesson whose `muxAssetId` matches. Set `muxAssetId` in the admin lesson editor to opt a
  lesson into that sync.
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

## Vercel Deployment Notes
- Web app deploy: set Vercel project root to `apps/diaz-ondemand-web`.
- API deploy: deploy `apps/api` as a separate service/project. Start it with `pnpm start`
  (root) or `pnpm --filter api start`, which sets `NODE_ENV=production` itself rather than
  relying on the host to export it.
- Pre-deploy checklist. The API **exits instead of starting** if any of these is missing:
  - `DIAZ_INTERNAL_API_KEY` - always required in production.
  - `STRIPE_WEBHOOK_SECRET` - required when Stripe is enabled (`STRIPE_SECRET_KEY` set).
  - `MUX_WEBHOOK_SECRET` - required in production when Mux is enabled (`MUX_TOKEN_ID` set).
  - The signing key pair `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` - required on any
    deployment, unconditionally, with no "is Mux enabled" condition attached.

  The first three are live because `pnpm start` sets `NODE_ENV=production`. The signing key
  pair does not depend on that: it is refused whenever `NODE_ENV=production` **or**
  `DATABASE_URL` points anywhere but loopback, so a run started as `node dist/main.js`,
  a Dockerfile `CMD` or a Procfile - none of which export `NODE_ENV` - is refused too.

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
- Prefer real host environment variables for those production values, with the monorepo-root
  `.env` as the local fallback. That is ordinary good practice for a deployed service, not a
  workaround for a load-ordering bug. `apps/api/.env` is **not** a blind spot: `app.module.ts`
  calls `ConfigModule.forRoot` inside its `@Module({ ... })` decorator argument, which is
  evaluated when `main.ts` statically imports `AppModule`, and `forRoot` writes the
  working-directory `.env` into `process.env` synchronously - both before `bootstrap()` calls
  `validateApiEnv`. So values placed in `apps/api/.env` **are** seen by startup validation.
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

## Scripts
- `pnpm dev` -> API + web
- `pnpm dev:mobile` -> Expo mobile
- `pnpm start` -> built API with `NODE_ENV=production` (deployed runs)
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test` (see [Tests](#tests))
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:seed`

## Tests

`pnpm test` runs everything. Most of the API suite mocks Prisma, but the Stripe billing lifecycle
does not: the resubscribe and double-subscription defects were unique-constraint violations that a
mocked client cannot raise, so `apps/api/src/tests/billing-lifecycle.db.test.ts` runs the real
services against a real Postgres.

Those tests **skip** unless `TEST_DATABASE_URL` is set, so `pnpm test` still works with no database
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
