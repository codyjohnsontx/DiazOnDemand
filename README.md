# Diaz on Demand Monorepo

Video-on-demand product monorepo for Diaz on Demand (separate from the Diaz Martial Arts marketing site). This repo contains:
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
- Video: Mux playback IDs (server token signing TODO included)

## MVP Features Included
- Browse Programs/Courses/Lessons (published only)
- Lesson playback on web and mobile using Mux playback IDs
- Progress upsert (`lastPositionSeconds`, `completed`)
- Favorites create/list/remove
- Admin CRUD + publish/unpublish for programs/courses/lessons
- Entitlement gating for paid lessons (`FREE` vs `PREMIUM`)
- Stripe checkout session endpoint
- Stripe webhook handler syncing `Subscription` + `Entitlement`
- Mux webhook endpoint stub with TODO

## Repository Layout
- `/apps/api`
- `/apps/diaz-ondemand-web`
- `/apps/mobile`
- `/packages/db`
- `/packages/shared`
- `/packages/ui`

## Environment Variables
Use root `.env.example` as source of truth.

Required core values:
- `DATABASE_URL`
- `DEV_BYPASS_AUTH` (`true` for local MVP)
- `DEFAULT_DEV_CLERK_USER_ID`
- `NEXT_PUBLIC_API_URL`
- `EXPO_PUBLIC_API_URL`

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
- `STRIPE_PRICE_ID_YEARLY`
- `WEB_APP_URL`

Mux (optional now):
- `MUX_TOKEN_ID`
- `MUX_TOKEN_SECRET`

Seed helper:
- `SEED_DEV_CLERK_USER_ID`

## Local Setup
1. Install deps:
```bash
corepack prepare pnpm@9.12.3 --activate
pnpm install
```

2. Configure env:
```bash
cp .env.example .env
```

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
2. Open seeded lesson and play video (placeholder playback IDs).
3. Progress saves every ~10 seconds and before unload.
4. Open admin at `http://localhost:3000/admin/programs`.
5. Create/edit/publish content.
6. Paid lessons require premium entitlement (returns HTTP 402 otherwise).

## Clerk Setup Notes (Web + Expo)
- Current MVP supports `DEV_BYPASS_AUTH=true` in development.
- API reads `x-dev-user-id` header and auto-upserts a user.
- For real Clerk auth, provide `CLERK_SECRET_KEY` + client publishable keys and pass bearer token from clients.
- TODO: wire real Clerk session token forwarding from web/mobile clients to API in production.

## Stripe + Webhooks
Create checkout session endpoint:
- `POST /billing/create-checkout-session`

Stripe webhook endpoint:
- `POST /webhooks/stripe`
- Handles:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Syncs:
  - `Subscription` row
  - `Entitlement` tier (`PREMIUM` while active/trialing/past_due, else `FREE`)

Test locally with Stripe CLI:
```bash
stripe listen --forward-to localhost:4000/webhooks/stripe
```

## Mux Notes
- Lessons store `muxAssetId` and `muxPlaybackId`.
- API currently returns `playbackUrl` using playbackId.
- TODO in API response for signed playback token generation using Mux signing keys.
- `POST /webhooks/mux` exists as a minimal stub.

## Vercel Deployment Notes
- Web app deploy: set Vercel project root to `apps/diaz-ondemand-web`.
- API deploy: deploy `apps/api` as a separate service/project.
- Ensure web has `NEXT_PUBLIC_API_URL` pointing at deployed API.
- Keep server secrets only on API environment.

## Scripts
- `pnpm dev` -> API + web
- `pnpm dev:mobile` -> Expo mobile
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm db:generate`
- `pnpm db:migrate`
- `pnpm db:seed`

## MVP TODO / Roadmap
- Real Clerk bearer token forwarding from web/mobile clients
- Signed Mux playback token endpoint
- Better admin UX for tags and ordering controls
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
Internal endpoint for the marketing site redirect logic.

Security:
- Requires header `x-diaz-api-key`
- Must match API env var `DIAZ_INTERNAL_API_KEY`
- Returns `401` if missing/invalid

Example:
```bash
curl -H "x-diaz-api-key: $DIAZ_INTERNAL_API_KEY" \
  http://localhost:4000/users/user_123/entitlements
```
