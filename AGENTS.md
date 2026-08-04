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
- confirm it actually ran:
  `gh api "repos/codyjohnsontx/DiazOnDemand/pulls/<n>/reviews" --jq '.[] | .submitted_at + " " + .state + " " + .commit_id'`

Skip that step and those later commits merge unreviewed. That is the whole reason the step exists.

Confirm in that reviews list, never in the bot's reply. The reply ("Action performed - Review
finished", plus a note about not re-reviewing reviewed commits) is the same boilerplate whether a
review follows or nothing does, and it arrives in about 5 seconds while the review itself takes a
couple of minutes. Reading the reply as evidence is how a config that had switched review off for
almost the whole repository survived for a day.

Which paths get reviewed at all is decided by `path_filters` in `.coderabbit.yaml`. Read the
comments there before adding an entry: an entry without a leading `!` is an include, and it
narrows review to only the paths it matches.

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
  (when `STRIPE_SECRET_KEY` is set), and `MUX_WEBHOOK_SECRET` (when `MUX_TOKEN_ID` is set).
  The signing key pair `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE` is required on any
  deployment as well, and does not depend on `pnpm start` - see the Mux entry below. The
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
- A PAID lesson's provider identifiers never leave the API on an unauthenticated payload, and
  the Mux one never sits next to a signed url - `publicVideoIdentifiers` in
  `apps/api/src/content/lesson-presentation.ts` nulls `muxPlaybackId` and `youtubeVideoId`
  together, and `mapAdminLessonSummary` puts them back for the admin routes only. One rule for
  every provider, so a new one cannot be added past it. `/programs`, `/programs/:id` and
  `/courses/:id` take no authentication, and neither id is a name for a video, it is the whole
  address of one: `stream.mux.com/<id>.m3u8` plays a public-policy Mux asset for anyone holding
  it, and a YouTube video id plays at youtube.com for anyone holding it unless that video is
  Private. Nothing ties `accessLevel` to `videoProvider` in `admin.service.ts`, so PAID plus
  YOUTUBE is saveable even though every seeded YouTube lesson is FREE. What an entitled member
  watches with is built in `mapLessonDetail`, behind the 402 in `ContentService.getLesson` -
  the signed `playbackUrl` for Mux, the `embedUrl` for YouTube.
  The Mux id has a second, independent reason. Measured in Chrome against `@mux/mux-player`
  3.11.4, a player handed both a `playbackId` and a signed `src` requests
  `stream.mux.com/<id>.m3u8?redundant_streams=true` and drops the token entirely -
  byte-identical to the request it makes with no `src` at all. The web player passes the id
  only when `src` carries no token for it to drop, and the mobile player prefers `playbackUrl`
  outright, so neither can drop a signed token today, but both ship separately from the API.
  Restoring the id to a paid payload would still widen the exposure, and would silently switch
  signed playback off in any client that passes both.
- The unsigned-playback fallback for a PAID lesson is gated on a loopback `DATABASE_URL`, not
  on `NODE_ENV`: `isUnsignedPaidPlaybackAllowed` in `apps/api/src/config/env.ts`, the same
  predicate and the same reasoning as the auth bypass above. Startup validation is the other
  half of the same rule and is keyed on the same fact: `MUX_SIGNING_KEY_ID` +
  `MUX_SIGNING_KEY_PRIVATE` are required whenever the run is a deployment - `NODE_ENV`
  production *or* a non-loopback database - unconditionally, with no "is Mux enabled" proxy.
  It used to be gated on `MUX_TOKEN_ID`; that drifted, because no runtime code reads that
  variable, so a deployment serving Mux video without it skipped the check and answered 500
  on every paid lesson with no boot-time signal. Any proxy can drift the same way; the
  signing key pair cannot, because it is exactly what `createMuxPlaybackToken` reads. Do not
  reintroduce a condition here. Verified against the built API with `NODE_ENV` unset
  throughout: it exits without opening a port when a signing key is missing on a deployed
  database, and a paid lesson answers 500 rather than an unsigned url when only the
  request-time half applies - both still behave the old way against a localhost database.
- The Mux `video.asset.ready` webhook requires a PAID lesson's asset to be signed-only: it
  refuses an asset offering no `signed` playback id, and equally refuses one carrying a
  `public` playback id even when a signed id sits beside it, because nothing stops a caller
  using the public one. It logs an error and throws, so the delivery fails in the Mux
  dashboard next to the asset whose upload policy is wrong, rather than quietly attaching a
  watchable id to a paid video. A FREE lesson takes the asset's public id, and is refused the
  same way when the asset carries none - it is served over a plain url, so an id with any
  other policy would be stored and then fail to play. See `syncMuxAsset` in
  `apps/api/src/webhooks/webhooks.service.ts`.
- What the code guarantees here is narrow, and the boundary is the point of this entry.
  Every check in this repository is repo-side. Together they prove one thing: the API stops
  emitting a PAID lesson's provider identifiers from this commit forward. They cannot retract
  an identifier already handed to an anonymous caller, cannot tell whether a given Mux asset
  was uploaded with a `public` playback policy, and cannot tell whether a paid lesson's
  YouTube video is still Public. Shipping this change did not make an already-served
  identifier safe. An asset uploaded to Mux with a `public` playback policy stays public, and
  rotating it is the only fix.
  The audit covers two populations, not one. First, lessons that are PAID today. Second, and
  this is the one that gets missed, lessons that were FREE and were later flipped to PAID:
  `updateLesson` in `apps/api/src/admin/admin.service.ts` applies a partial update, so setting
  `accessLevel` leaves the row holding the provider identifier it already had, and that
  identifier was served to every anonymous `/programs` caller for as long as the lesson was
  free. This was reproduced end to end against the built API on a seeded database. It is what
  happens, not what might happen.
  Two checks only the project owner can settle, neither of them from this repository: every
  paid Mux asset must use a signed playback policy, which is a Mux dashboard job, and every
  paid YouTube-hosted lesson must not be publicly listed, which is a YouTube Studio job.
  Unlisted is not the same as retracted, because a YouTube video plays for anyone holding its
  id unless that video is Private, so an identifier already served is closed only by rotating
  the Mux asset or restricting the YouTube video. Agents must not touch the Mux account to
  check. This is deliberately not mitigated in code; a partial mitigation would only make it
  look handled.
- The mobile sign-in screen never renders a provider's error text, and no Clerk answer at the
  email step changes what the user sees. The flow has no password step, so an address with no
  Clerk account would otherwise fail visibly differently from a member's, and that difference
  is the whole answer to "is this person a member of the gym?". Every message is written in the
  app - see `messages` in `apps/mobile/src/sign-in-screen.tsx`; any Clerk API response at the
  email step lands on the same code screen a real member reaches; and the code step gives one
  message for every failure, so a wrong code and an address with no account read alike. The one
  deliberate asymmetry is a failure Clerk never answered at all (offline, service unreachable):
  it is reported as unreachable and stays on the email step, because that outcome cannot depend
  on the identifier. Known residual, not closable from this repository: the known path makes two
  round trips and the unknown path one, so response timing still differs. Clerk's Strict user
  enumeration protection is the owner's half of it - see "Clerk Setup Notes" in README.md.
  No automated test guards either property: `apps/mobile` has no test runner at all (its
  `test` script is an echo), so anything changed on this screen has to be re-checked by hand.

## Catalogue video states

A published lesson may resolve to exactly one of three states, and nothing else: real
playable video, a labelled demonstration clip, or an explicit not-yet-filmed state. The
read path is what enforces it. `resolveVideoProvider` in
`apps/api/src/content/lesson-presentation.ts` returns `NONE` for an identifier that is
provably unusable - `isValidMuxPlaybackId` / `isValidYouTubeVideoId` in `@diaz/shared` - so a
member sees the honest empty state instead of a player that loads and then fails with "Video
does not exist".

The cause is closed structurally, not only the symptom: `LessonSeed` in
`packages/db/prisma/seed-curriculum/programs.ts` has no field for a Mux playback id, so the
seed cannot fabricate one again and `pnpm typecheck` fails if someone adds one. That is where
all 16 broken lessons came from - seed data inventing ids to fill out a catalogue, not Mux
and not an admin typo. It also makes the surviving ids trustworthy by construction: every Mux
id now reaching the database arrives through the `video.asset.ready` webhook, so it is one
Mux issued. Validating an admin-typed id against Mux is deliberately deferred and tracked
separately; do not build it.

The read-path rule stays as the backstop for rows this repository never wrote. It rejects a
known-bad set, not a guessed-at good shape, and that direction is load-bearing. It rejects the 16 placeholders this repository seeded, listed in
`video-source.ts` and checkable against git history, plus values that are unsafe to
interpolate into `stream.mux.com/<id>.m3u8`. Everything else is accepted, because Mux
documents `PlaybackID.id` only as a string. An earlier version required 20 or more
characters on an assertion that Mux issues ids of 35 to 50; Mux's own API reference example
is the 18-character `a1B2c3D4e5F6g7H8i9`, so that floor hid a real video behind "not filmed"
- the same lie this rule exists to stop, pointed the other way and silent. An independent
review reproduced it. Do not reintroduce a length floor; `video-source.test.ts` pins the
18-character example as accepted and all 16 placeholders as rejected. The YouTube rule is
the documented fixed 11-character format, which is a real contract rather than a guess.

The rule cannot decide whether an accepted identifier addresses anything, in either
direction: a mistyped-but-URL-safe id is accepted and fails in the player. Only the provider
could settle that, agents must not ask it, and catching a newly typed placeholder needs
provider validation at a write boundary rather than a shape rule.

`mapAdminLessonSummary` deliberately reports the *stored* provider instead of the resolved
one. The lesson editor loads that payload straight into its form, so a resolved `NONE` would
hide the playback-id field and blank the identifier on the next save.

That payload is therefore honest about the row and silent about playback, which would leave
the one person who can fix a mistyped id with nothing to see. The admin surfaces carry a
non-blocking hint instead: `hasUnplayableVideoIdentifier` in `@diaz/shared` marks a stored
identifier the read path will refuse, beside the id fields in the lesson editor and on the
admin course lesson rows. It rejects nothing and blocks no save, because a shape rule cannot
be checked against the Mux account.

Member surfaces show no runtime for a lesson that resolves to `NONE`: `hasPlayableVideo`
gates `durationLabel` in `buildLessonQueue` and the watch-page duration badge. The seeded
`durationSeconds` stays in the database as a planned length, and course-level and
program-level totals still count it.

Current counts, and the 16 seeded mnemonic ids that caused this, are in the "Catalogue Video
States" section of README.md. The public payload follows the same resolution: an identifier
the read path refuses never leaves `publicVideoIdentifiers`, at any access level.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
