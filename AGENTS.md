Purpose
This file provides operational rules for AI coding agents (Claude Code, Cursor, Copilot, Aider).
Agents must follow these instructions to produce safe, predictable, minimal changes.

Instruction priority:
1. Direct user instruction
2. This AGENTS.md
3. Existing repository patterns

Operating Principles
Agents must behave like a careful engineer.

Always:
- read nearby code before editing
- match existing patterns
- make small focused changes
- prefer minimal diffs
- stop and report errors instead of guessing

Never:
- refactor unrelated code
- introduce large rewrites
- change architecture without instruction

Diff Size Guardrail
Agents should keep changes small.

Preferred limits:
- < 200 lines changed
- < 5 files modified

If larger work is required:
- explain why
- propose the plan
- wait for approval

Project Structure
Example structure:

apps/my-app/src/
packages/ui/src/
packages/lib/src/

Guidelines:
- standalone applications live in `apps/*`
- shared libraries live in `packages/*`
- UI -> components
- business logic -> lib
- hooks -> hooks
- API handlers -> api
- tests -> tests

These mapping rules apply within each app or package.
Do not create new top-level folders unless required.

Commands
Use these commands to validate work.

```bash
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm typecheck
```

Before finishing work run:
- pnpm build
- pnpm lint

Do not claim tests passed unless executed.

Editing Rules
When editing code:
- modify only what the task requires
- preserve formatting and structure
- reuse existing utilities
- avoid renaming symbols unnecessarily
- avoid introducing new dependencies

Prefer extending existing modules over creating duplicates.

Architecture Awareness
Before writing code, agents should identify:
- where similar functionality already exists
- the module responsible for the domain
- existing utilities that solve similar problems

Avoid creating parallel implementations.

Boundaries
Agents must never modify or expose:
- .env
- .env.local
- node_modules
- dist
- build

Never expose:
- API keys
- credentials
- tokens
- service role secrets

Never move server logic into client code.

Database Safety
Database changes are high risk.
Agents must not:
- drop tables
- rename columns
- delete data
- run destructive migrations

Unless explicitly requested.

When schema changes are required:
Agents must explain:
- affected queries
- affected API routes
- affected UI components

Migration Rules
When migrations are required:
- prefer additive changes
- preserve backward compatibility
- avoid destructive edits

Never rewrite migration history.

Dependency Policy
Prefer the existing stack.
Do not install packages for functionality already provided by:
- the framework
- the language
- existing libraries

If a dependency is necessary:
Explain:
- why it is required
- why existing tools cannot solve the problem

Git Rules
Run git commands one at a time.
Stop immediately if a command fails.

Agents must not automatically:
- force push
- reset
- rebase
- amend commits
- delete branches

Do not run git commands if the working tree is dirty.

Pull Request Workflow
When preparing a PR:
- confirm working tree is clean
- `git status`
- show outgoing commits
- `git log --oneline main..HEAD`
- push branch
- `git push -u origin HEAD`
- create PR with explicit title and body

Never rely on auto-generated PR text.

CodeRabbit reviews a pull request once, when it is opened.
Automatic re-review on later pushes is deliberately off
(`reviews.auto_review.auto_incremental_review: false` in `.coderabbit.yaml`), to conserve a
shared usage limit.

So if a pull request gained commits after it was opened:

- comment `@coderabbitai review`
- wait for that review before merging

Skip that step and those later commits merge unreviewed. That is the whole reason the step exists.

Debugging Rules
When fixing bugs:
- reproduce the issue
- identify root cause
- implement minimal fix
- validate with build/tests

Avoid speculative fixes.
Change one variable at a time.

Performance Guardrails
Avoid:
- unnecessary renders
- repeated network requests
- heavy computation inside render loops

Prefer simple predictable optimizations.
Do not prematurely optimize.

Documentation Rules
Update docs when:
- commands change
- setup changes
- APIs change
- architecture changes

Do not leave outdated documentation.

Known Agent Mistakes
Avoid these common problems:
- replacing native <select> elements unnecessarily
- introducing new UI frameworks
- renaming files without reason
- rewriting working patterns
- creating duplicate utilities

Definition of Done
A task is complete when:
- requested change is implemented
- build succeeds
- lint passes
- project conventions are followed
- no unrelated files were modified

Future Extensions
Mature AI repos often add:
- architecture diagrams
- API conventions
- event naming rules
- auth rules
- billing rules
- observability rules
- deployment checklist

Final Rule
Act like a careful teammate.
Understand first.
Make minimal changes.
Validate results.
Communicate clearly.

## Billing and tests

Most of the API suite mocks Prisma. The Stripe billing lifecycle deliberately does not:
`apps/api/src/tests/billing-lifecycle.db.test.ts` needs `TEST_DATABASE_URL` pointing at a
migrated Postgres, and skips without it (but fails the run on CI). See the Tests section of
README.md for the exact commands.

Two billing invariants that are easy to break by accident:
- A member has *many* `Subscription` rows over time, never one. Cancel-then-resubscribe issues a
  new Stripe subscription id.
- The `Entitlement` is always derived from the stored subscription rows, never written straight
  from the Stripe event being handled. See `resolveStripeEntitlement` in
  `apps/api/src/common/entitlement.ts`.

## Security Invariants

Do not weaken these. Each one is load-bearing for a security property of this repo, and
the reason it exists is stated with it.
- The dev auth bypass (`DEV_BYPASS_AUTH`) is gated on `DATABASE_URL` pointing at
  loopback, not on `NODE_ENV`. The only thing in this repo that sets `NODE_ENV` is the
  `pnpm start` script (next bullet), so a `NODE_ENV === 'production'` check alone is
  inert on any run that does not go through it and does not export it either. See
  `isDevAuthBypassEnabled` in `apps/api/src/config/env.ts` and the tests in
  `apps/api/src/tests/env.test.ts`. Verified end to end against the built API with `NODE_ENV`
  unset throughout: it exits without opening a port whenever `DEV_BYPASS_AUTH=true` meets a
  non-loopback `DATABASE_URL` - whether the flag comes from the host environment or from an
  app-directory `.env` - and still boots and authenticates an uncredentialed request as the
  seeded admin on a loopback database. On 2026-08-02 the project owner confirmed the
  deployed API running with `NODE_ENV=development` and `DEV_BYPASS_AUTH=true`, and set the
  flag to `false` that day as an immediate mitigation.
- Deployed API runs start via `pnpm start`, which sets `NODE_ENV=production` itself.
  That makes the production-only startup checks live, so a deploy needs these set or the
  API exits instead of starting: `DIAZ_INTERNAL_API_KEY` (always), `STRIPE_WEBHOOK_SECRET`
  (when `STRIPE_SECRET_KEY` is set), and `MUX_WEBHOOK_SECRET` plus the signing key pair
  `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` (when `MUX_TOKEN_ID` is set). The
  refusal is deliberate - do not relax a check to get a deploy green.
- Every `.env.example` in the repo - root, `apps/api`, `apps/diaz-ondemand-web`,
  `apps/mobile` - ships its bypass flag as `false`. Keep all four copy-safe; the
  `apps/api` one sits inside the deployed service and is the likeliest to be copied
  onto a server.
- Prefer host env vars or the monorepo-root `.env` for production API values - ordinary good
  practice, not a workaround. `apps/api/.env` is still covered by startup validation:
  `ConfigModule.forRoot` sits in the `@Module` decorator argument in `app.module.ts`, evaluated
  when `main.ts` statically imports `AppModule`, and it writes the cwd `.env` into `process.env`
  synchronously - both before `bootstrap()` calls `validateApiEnv`. This entry previously
  claimed the opposite and called the load ordering unfixed; there is no defect and nothing
  to fix. It is also why the bypass refusal fires for a flag set in `apps/api/.env`.
- Acknowledged residual risk: `isLoopbackDatabaseUrl` inspects the `DATABASE_URL` host, so a
  deployment whose database URL is itself loopback satisfies that check - an API reaching
  Postgres through a Cloud SQL Auth Proxy or pgbouncer sidecar on `127.0.0.1`, or Prisma's
  socket form `postgresql://u:p@localhost:5432/db?host=/cloudsql/...`. The loopback gate
  passes in that shape, but the bypass still does not activate unless someone also
  deliberately sets `DEV_BYPASS_AUTH=true` and the run is not `NODE_ENV=production`. The
  residual risk is that combination, not the loopback proxy on its own. This is written
  down on purpose; do not add detection code for it.
- A PAID lesson's Mux playback id never leaves the API on an unauthenticated payload, and
  never sits next to a signed url - `publicPlaybackId` in
  `apps/api/src/content/lesson-presentation.ts` nulls it, and `mapAdminLessonSummary` puts it
  back for the admin routes only. Two reasons, both load-bearing. `/programs`, `/programs/:id`
  and `/courses/:id` take no authentication, and a Mux playback id is the whole address of a
  video, not a name for it. And, measured in Chrome against `@mux/mux-player` 3.11.4, a player
  handed both a `playbackId` and a signed `src` requests
  `stream.mux.com/<id>.m3u8?redundant_streams=true` and drops the token entirely -
  byte-identical to the request it makes with no `src` at all. So restoring the id to a paid
  payload would not merely widen the exposure, it would silently switch signed playback off.
- The unsigned-playback fallback for a PAID lesson is gated on a loopback `DATABASE_URL`, not
  on `NODE_ENV`: `isUnsignedPaidPlaybackAllowed` in `apps/api/src/config/env.ts`, the same
  predicate and the same reasoning as the auth bypass above. Startup validation refuses
  `MUX_TOKEN_ID` without `MUX_SIGNING_KEY_ID` on a non-loopback database as well as in
  production. Verified against the built API with `NODE_ENV` unset throughout: it exits
  without opening a port when Mux is enabled with no signing key on a deployed database, and
  a paid lesson answers 500 rather than an unsigned url when only the request-time half
  applies - both still behave the old way against a localhost database.
- The Mux `video.asset.ready` webhook refuses an asset that offers no `signed` playback id for
  a PAID lesson: it logs an error and throws, so the delivery fails in the Mux dashboard next
  to the asset whose upload policy is wrong, rather than quietly attaching a public id to a
  paid video. FREE lessons still take a public id. See `syncMuxAsset` in
  `apps/api/src/webhooks/webhooks.service.ts`.
- What none of that fixes, and only the owner can: an asset already uploaded to Mux with a
  `public` playback policy stays public, and no code change can retract an id that has already
  been served. Confirming every paid asset uses a signed playback policy is a Mux dashboard
  job. Agents must not touch the Mux account to check.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
