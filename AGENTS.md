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

Most of the API suite mocks Prisma. Two suites in `apps/api/src/tests` deliberately do not,
because what they cover is invisible to a mocked client: `billing-lifecycle.db.test.ts`, for the
unique-constraint violations below, and `mux-ingestion.db.test.ts`, for the `Lesson` CHECK
constraint. Both need `TEST_DATABASE_URL` pointing at a migrated Postgres, and skip without it
(but fail the run on CI). See the Tests section of README.md for the exact commands.

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
- Every startup requirement that is meant to hold on a server asks `isDeployment` in
  `apps/api/src/config/env.ts` - `NODE_ENV=production` *or* a non-loopback `DATABASE_URL` -
  never `NODE_ENV === 'production'` on its own. A deploy needs these set or the API exits
  instead of starting: `DIAZ_INTERNAL_API_KEY`, `MUX_WEBHOOK_SECRET`, and the signing key
  pair `MUX_SIGNING_KEY_ID` + `MUX_SIGNING_KEY_PRIVATE`, all unconditionally, plus
  `STRIPE_WEBHOOK_SECRET` when `STRIPE_SECRET_KEY` is set. The refusal is deliberate - do
  not relax a check to get a deploy green, and do not reintroduce a `NODE_ENV` spelling.
  `pnpm start` setting `NODE_ENV=production` is no longer the only condition that makes any
  of them live, and relying on it alone was the defect: `NODE_ENV=production` still activates
  every one of them; the non-loopback `DATABASE_URL` is an additional trigger rather than a
  replacement. Measured against the built API with `NODE_ENV` never set and a non-loopback
  `DATABASE_URL`, it booted, answered `/health` 200, and rejected every Mux delivery, every
  Stripe delivery and every internal entitlement lookup. It now exits without opening a port.
  One condition was removed and one kept, and the distinction is the point. A condition may
  only stay if it is a reliable signal that the thing it gates is actually in use.
  `MUX_TOKEN_ID` is not: nothing on the webhook or playback path reads it - its one runtime
  reader is `MuxDirectUploadService`, which answers the lesson editor's upload route 503
  without it - so it says nothing about whether Mux webhooks are wired, and gating the webhook
  secret on it let a deployment serving Mux video skip the check - the same drift the
  signing-key rule was rescued from.
  `STRIPE_SECRET_KEY` is: it is exactly what `BillingService` and `WebhooksService` construct
  the Stripe client from, so it stays.
- Every `.env.example` in the repo - root, `apps/api`, `apps/diaz-ondemand-web`,
  `apps/mobile` - ships its bypass flag as `false`. Keep all four copy-safe; the
  `apps/api` one sits inside the deployed service and is the likeliest to be copied
  onto a server.
- Prefer host env vars or the monorepo-root `.env` for production API values - ordinary good
  practice, not a workaround. `apps/api/.env` is still covered by startup validation:
  `ConfigModule.forRoot` sits in the `@Module` decorator argument in `app.module.ts`, evaluated
  when `create-app.ts` statically imports `AppModule`, and it writes the cwd `.env` into
  `process.env` synchronously - both before `createApiApp()` calls `validateApiEnv`, on either
  entrypoint, since both reach `AppModule` through `create-app.ts`. This entry previously
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
  every provider, so a new one cannot be added past it - and that completeness is the property,
  not the exposure of any one field. `muxAssetId` is listed in that same function and answered
  null at every access level, because it is admin-only; it was read straight off the row in
  `mapLessonDetail` until it was routed through the gate, and the fix was worth making for the
  property even though the field addresses no stream. Add a new identifier to that function or
  it is not covered. `/programs`, `/programs/:id` and `/courses/:id` take no authentication, and
  neither playback id is a name for a video, it is the whole address of one:
  `stream.mux.com/<id>.m3u8` plays a public-policy Mux asset for anyone holding
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
- Flipping a lesson from FREE to PAID clears its stored `muxPlaybackId`, because withholding an
  identifier is not the same act as retiring one. `clearsMuxPlaybackIdOnPaidTransition` in
  `@diaz/shared` holds the rule; `planPaidAccessTransition` in
  `apps/api/src/admin/admin.service.ts` applies it on the one write path both admin PATCH routes
  go through. A FREE lesson publishes that id to anonymous `/programs` callers once it is
  published - every public read filters `isPublished` - so on a public-policy asset
  `stream.mux.com/<id>.m3u8` plays for anyone who read the catalogue first, forever, and the flip
  stops the API handing the id out while taking nothing back. `syncMuxAsset` gives a FREE lesson
  only a public playback id, but it is not the column's only writer: PAID -> FREE keeps the id the
  row already holds, so a FREE lesson can be carrying a signed-only one. The rule fires on every
  flip anyway, because nothing on the row records the asset's policy and clearing is the only
  choice that cannot leak; the cost on a PAID -> FREE -> PAID round trip is a redelivery of
  `video.asset.ready`, which restores the same signed-only id. That is why the admin copy states
  the rule flatly and states both the public-policy claim and the disclosure as conditions, and
  why its remedy names redelivery before re-creating the asset. Reproduced end to end
  against the built API on a real Postgres before the fix: anonymous `/programs` and
  `/lessons/:id` handed over the id and the plain url, the admin PATCH set PAID, `/programs`
  correctly went quiet, and the row still held that exact id. Clearing it forces the only fix
  that works on a public asset - a new signed-only one, whose id nobody holds - and `syncMuxAsset`
  refuses to reattach a public id to a PAID lesson, so the re-ingestion cannot put the same kind
  of identifier quietly back. Four parts of it are load-bearing. A write supplying a *different*
  id is the rotation itself and is left alone, or the guard would eat the value an operator just
  typed. The clear has to leave a row `lesson_video_provider_consistency_chk` accepts, so a
  lesson with no `muxAssetId` to fall back on drops to `videoProvider = NONE` instead of
  answering 500; one that keeps its asset id lands in the "Waiting for Mux" state, which is
  where the operator's record of the upload belongs. And the PATCH response carries
  `muxPlaybackIdClearedForPaidAccess`, because a silent clear is a different bug wearing the same
  shape - the lesson editor warns beside the access level before the save and reports the API's
  own answer after it. Nothing is stored: a column recording the clear could only drift from the
  three fields that already describe the video. And the editor *adopts* the row that answer
  describes, the moment the save returns - `lessonEditorFieldsAfterSave` in `@diaz/shared` is that
  rule - because the form it saved from still holds the retired id until `load()` returns from
  `/admin/programs`, and a second Save in that window PATCHes it back onto a row that is PAID by
  then: the transition is PAID -> PAID, no clear is due, and the identifier is written straight
  back under a plain "Lesson saved.". An in-flight guard on submit closes the same window from the
  other side. `apps/diaz-ondemand-web` has no test runner, so nothing mechanical guards this: an
  agent deleting the adoption as a redundant pre-reload write re-opens the leak with every check
  still green, which is why the rule and its tests live in `packages/shared` and pin the rule
  rather than the wiring.
  `youtubeVideoId` is deliberately not cleared, and the asymmetry is a conclusion rather than an
  omission. A Mux playback id is rotatable; a YouTube video id is the video's permanent name on
  YouTube, so re-ingesting yields the same id and clearing the column retires nothing that
  leaked. There is no signed variant to rotate *to* either - an entitled member gets
  `youtube-nocookie.com/embed/<id>`, the same public address the free catalogue published - so a
  PAID YouTube lesson has exactly one handle, and clearing it would break a working lesson while
  leaving the leaked id as playable as it was. That is a clear with no rotation behind it, which
  is the shape of a mitigation that only looks like one. The remedy is in YouTube Studio, and the
  lesson editor says so beside the field, so the Mux warning cannot imply by contrast that
  premium protects a YouTube lesson.
- The unsigned-playback fallback for a PAID lesson is gated on a loopback `DATABASE_URL`, not
  on `NODE_ENV`: `isUnsignedPaidPlaybackAllowed` in `apps/api/src/config/env.ts`, the same
  predicate and the same reasoning as the auth bypass above. Startup validation is the other
  half of the same rule and is keyed on the same fact: `MUX_SIGNING_KEY_ID` +
  `MUX_SIGNING_KEY_PRIVATE` are required whenever the run is a deployment - `NODE_ENV`
  production *or* a non-loopback database - unconditionally, with no "is Mux enabled" proxy.
  It used to be gated on `MUX_TOKEN_ID`; that drifted, because nothing that serves or ingests
  video reads that variable (only the lesson editor's direct-upload route does), so a
  deployment serving Mux video without it skipped the check and answered 500
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
  `accessLevel` left the row holding the provider identifier it already had, and that identifier
  was served to every anonymous `/programs` caller for as long as the lesson was free. This was
  reproduced end to end against the built API on a seeded database. It is what happened, not what
  might have happened. The Mux half of it is now closed at that write boundary - see the
  FREE -> PAID entry above - but only for flips from that commit forward, and only for
  `muxPlaybackId`. A flip that already happened left the id in place, and the YouTube half is not
  closable from here at all. Both populations still need the audit.
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

## Mobile app (Expo SDK)

`apps/mobile` targets Expo SDK 54 on purpose, not the newest SDK. Store-installed Expo Go has been
frozen at SDK 54 since May 2026 (Expo's "Expo Go and the App Store in May 2026" changelog) while the
published SDK line has moved well past it, and the project owner opens this app through the store
build of Expo Go. Raising the SDK past 54 makes the app unopenable on his phone, which is the exact
failure the SDK 52 to 54 upgrade existed to fix. Do not run `expo install expo@latest` here. Re-check
the current store ceiling before proposing any further bump, and when it moves, go one SDK at a time
with `npx expo install --fix` then `npx expo-doctor`.

Three things that bite on an SDK bump here:
- The `tokenCache` prop passed to `ClerkProvider` in `App.tsx` is the only reason the session token
  lives in `SecureStore`. Drop it and `@clerk/clerk-expo` falls back to an in-memory cache
  (`createClerkInstance.js` defaults `tokenCache = MemoryTokenCache`) with no error and no warning,
  silently voiding the storage property behind the sign-in entry above.
- `expo-av` still ships in SDK 54 and its native module is present in Expo Go 54, but SDK 55 removes
  it. `LessonScreen` in `src/mobile-app.tsx` is the only caller and has to move to `expo-video`
  before any SDK 55 attempt.
- Screens take `SafeAreaView` from `react-native-safe-area-context`, never from `react-native`.
  RN 0.81 deprecates its own `SafeAreaView` and defines it as
  `Platform.select({ ios: <native view>, default: View })`, so on Android it applies no insets at
  all, and SDK 54 makes Android edge-to-edge, which leaves content under the status bar. Moving
  that import back reads as a harmless cleanup and shows nothing wrong on an iOS simulator.

Before trusting a device measurement of a mobile change, confirm the bundle Metro serves carries
it: `curl -s 'http://localhost:8081/apps/mobile/index.bundle?platform=ios&dev=true' | grep -c
<new symbol>`. Measured on the mobile resume fix with no watchman installed: Metro answered a
one-module HMR delta after the edit and then served a full bundle without it to a cold-started
Expo Go, so a working fix measured as broken. `expo start --clear` fixes it. Two more things
from that session: `pnpm dev` and every lane's API bind port 4000, so on a shared machine set
`PORT` in `.env` and check `lsof -nP -iTCP:4000 -sTCP:LISTEN` before trusting `curl localhost:4000`,
or admin PATCHes land in another checkout's database; and `idb ui tap` (brew `idb-companion` +
pip `fb-idb`) drives the simulator without the macOS Accessibility permission AppleScript needs.

## Clerk route shape on the web app

Every Clerk UI component that does path routing owns sub-paths under where it is mounted, so it
must live at an optional catch-all route, not a fixed one. `<SignIn />` sits at
`apps/diaz-ondemand-web/app/sign-in/[[...sign-in]]/page.tsx` for that reason. It is currently the
only routed Clerk component in the repo; there is no `/sign-up` route, and the card's "Sign up"
link goes to Clerk's hosted account portal because `NEXT_PUBLIC_CLERK_SIGN_UP_URL` is unset. Mount
any future one the same way.

Mounted at a fixed `app/sign-in/page.tsx` it looks fine, because the flows that stay on the page
never leave it. Only a flow that hands off to a provider and comes back breaks: OAuth returns to
`/sign-in/sso-callback`, Next has no such route, and the user is authenticated and then dropped on
a 404. That is one bug for every social provider at once, and it does not reproduce through the UI
in the app - `curl` the callback path directly.

Clerk ships the check for this. `useEnforceCatchAllRoute` fetches
`<mounted path>/<Component>_clerk_catchall_check_<ts>` in development and throws if it 404s, so
`curl -o /dev/null -w '%{http_code}' http://localhost:3000/sign-in/SignIn_clerk_catchall_check_1`
answers "is this route shaped right" without any Clerk credentials. 404 means broken, 200 means
correct.

The other half is `middleware.ts`, and it fails in both directions. `createRouteMatcher` patterns
must not cover the sign-in tree, or Clerk's callback is protected by the auth it exists to
complete; the `config.matcher` must still cover it, or the handshake never gets its cookies.
Neither announces itself. Both are pathname-only decisions, so a route-shape change cannot alter
them by itself - assert it rather than assume it, by running the two matchers from `middleware.ts`
over the paths directly.

## The web app's Next.js pin

`apps/diaz-ondemand-web` pins `next` exactly, no caret, because the safe version is an
intersection of several constraints rather than "latest". Do not move it by picking a newer
version; re-derive the floor, and record the result. The constraints, the advisory evidence
behind the current pin, and which advisories stay open at it are in the "Next.js Version Floor"
section of README.md.

Three things that decide the answer and are easy to skip:

- Vercel fails the *build* for a version vulnerable to CVE-2025-66478, so a version can be
  current on advisories and still be undeployable. Its escape hatch
  (`DANGEROUSLY_DEPLOY_VULNERABLE_CVE_2025_66478=1`) must not be used.
- `pnpm audit` and OSV are necessary and not sufficient. Vercel publishes some advisories to
  the vercel/next.js repository before the global databases ingest them, so a clean audit can
  coexist with an unlisted critical - measured, not hypothetical. Querying that repository
  directly is the step that catches those, and it is where both criticals open at the current
  pin came from. Run the whole recipe, not part of it: "Checking a candidate version" in
  README.md is the authoritative copy.
- `@clerk/nextjs` constrains `next` through its peer range. Read the installed package's
  `peerDependencies`; an unmet `next` peer in `pnpm install` output is the signal.

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

A fourth state sits alongside those three and is derived, never stored: a lesson holding a
`muxAssetId` with no `muxPlaybackId` and no `youtubeVideoId` is waiting for a playback id.
`isAwaitingMuxPlayback` in `@diaz/shared` is the only place that decides it, and those fields
already say everything a status column would - so there is nothing to fall out of step with
them, and `where: { muxAssetId: { not: null }, muxPlaybackId: null, youtubeVideoId: null }` is
the whole answer to "which uploads never completed". Members see NONE, because nothing plays
yet; staff see a "Waiting for Mux" badge on the admin course rows and in the lesson editor.

`videoProvider` is deliberately not part of that definition, and adding it back re-opens the
drift the derived state exists to close. `syncMuxAsset` finds the lesson by asset id alone and
writes MUX itself, so a row that lost its provider is still a row the webhook will complete -
and re-running `pnpm db:seed` produces exactly that shape, because `packages/db/prisma/seed.ts`
writes `videoProvider` back to the seeded value and `muxPlaybackId` to null while leaving
`muxAssetId` in place. The lesson editor therefore shows the Mux asset ID field whenever the
row is awaiting, not only when the form provider is MUX, or the field the badge points at would
be invisible and the next save would blank it.

The webhook may be late, may repeat, may already have been delivered before any lesson held the
asset id, and may never arrive at all - none of those are error paths. `syncMuxAsset` writes
only fields that would actually change, so a redelivery does not even bump `updatedAt`. The
early-delivery case is the likely default for the manual path, where the admin uploads in Mux
and pastes the asset id in afterwards: `video.asset.ready` is delivered while no lesson holds
the asset id, the handler logs "No lesson matches" and answers 201 so Mux never retries. The
lesson editor's direct upload (below) stores the upload id before the file exists, so it does
not have this window. Nothing re-reconciles that, on purpose - resolving the asset from Mux at save time
is the separately tracked `diaz-mux-id-write-validation`. Both admin surfaces name the remedy
instead, from one shared component (`AwaitingMuxPlaybackNote`) so they cannot drift: redeliver
`video.asset.ready` from the Mux dashboard, which only completes an asset whose playback policy
the access level accepts - otherwise the fix is the asset, signed-only for PAID and public for
FREE.

"Blank" means what the database means by it, and that is narrower than JavaScript's.
`lesson_video_provider_consistency_chk` asks `NULLIF(TRIM(<column>), '')`, and Postgres `TRIM()`
strips U+0020 only, while `String.prototype.trim()` strips every Unicode whitespace character.
So a tab-only `youtubeVideoId` is *present* to the constraint and *blank* to `.trim()`.
`isStoredIdentifierAbsent` in `@diaz/shared` is the single rule every layer asks -
`isAwaitingMuxPlayback`, `hasUnplayableVideoIdentifier`, the `syncMuxAsset` guard and the admin
write boundary `adminUpdateLessonSchema` - and it deliberately strips spaces only. Do not
"simplify" it to `.trim()`: that is how the bug was written. A guard that read a tab as blank
waved through the very `videoProvider = MUX` write the constraint rejects, on a row whose
"Waiting for Mux" badge had just told an admin to redeliver the event - a 500 Mux then retries
forever. The database is the authority because it is the only layer that can refuse the write.
Tightening the definition is fine and is a migration: change the CHECK constraint first, the
JavaScript second, never the reverse.

What made that state unstorable was `lesson_video_provider_consistency_chk`, a CHECK
constraint added in `20260307235900_three_discipline_demo` and widened in
`20260901090000_lesson_mux_awaiting_playback`, together with the client-side guard in the admin
lesson editor. Those two are the whole list. The `videoSchema` rule in
`packages/shared/src/schemas.ts` was **not** on the write path and never refused a save - it
types `lessonDetailSchema`, which exists only for the `LessonDetailDto` type, nothing parses
either, and the admin PATCH validates with `adminUpdateLessonSchema`. An earlier account named
that rule as the blocker; it was wrong, and this is the correction, not a further version of it.
Nothing in `schema.prisma` mentions the constraint, because Prisma does not model CHECK
constraints - and the API suite mocks Prisma, so **no mocked test can see it**: against the
mocks the ingestion chain looked like it worked while every real save answered 500. That is what
`apps/api/src/tests/mux-ingestion.db.test.ts` is for; it needs `TEST_DATABASE_URL` like the
billing one. A MUX row must still hold one of the two identifiers and must not hold a YouTube
id, so the webhook refuses a lesson that still has one rather than letting a constraint
violation become an endless Mux retry. Blank is stored as NULL and never as an empty string, or
a query for the waiting lessons misses exactly the rows it is looking for -
`adminUpdateLessonSchema` normalises it at the admin PATCH boundary, so that holds for every
writer rather than only for the lesson editor.

Direct upload from the lesson editor adds two Lesson columns and one derived state, and four
things about them are load-bearing. `muxUploadId` is held only between
`POST /admin/lessons/:id/mux-upload` and `video.upload.asset_created`; the binding clears it in
the same write that sets `muxAssetId`, and that clearing is what lets "holds an upload id" mean
"Mux has not received the file" and nothing else. `muxVideoError` is written by
`video.upload.errored`, `video.upload.cancelled` and `video.asset.errored` and cleared by a new
upload request, a ready event that brings a new playback id or completes the upload the lesson was
waiting on, and the YouTube save below. Neither column is on `adminBaseLessonSchema`, so no client can
set or clear them; the one PATCH-side write is `planYouTubeUploadStateClear` in
`admin.service.ts`, which clears both when the saved lesson is a YouTube lesson, because a YouTube
row has nothing for them to describe and the badges they drive would otherwise outrank a working
video with nothing in the app able to clear them. A redelivered ready for the asset already
playing never clears the error, because that would erase the record of a failed replacement, and
a `video.asset.errored` for an asset the lesson has already moved on from - it holds a newer
upload id - is skipped rather than re-raising FAILED over the retry. `resolveLessonVideoState` in `@diaz/shared` is the only place that
turns the five stored fields into NONE / UPLOADING / PROCESSING / READY / FAILED, with FAILED and
UPLOADING outranking READY so a replacement in flight over a playing lesson is legible;
`lesson-video-state.tsx` is the only place that words them, for both admin surfaces.
Replacement retires the old playback id at `asset_created`, not at the upload request, for the
reason the FREE -> PAID flip retires it; the previous asset is deliberately left in Mux. The
playback policy is chosen from the tier when the upload is created (`playbackPolicyForAccessLevel`)
and checked again by `syncMuxAsset` when the asset is ready, so a tier flipped mid-encode is
refused rather than served. `syncMuxAsset` finds a lesson by asset id first and by the asset's
`upload_id` second, because Mux orders nothing. The editor populates its form once per lesson id
and adopts from every polled row only what changed, through `lessonEditorFieldsAfterRowChange`,
the measured duration included: the webhooks change the row behind the form, and a Save that
resent it would blank the binding or overwrite the measured length with a planned one. An
unchanged stored value is never adopted from a poll, because that is a revert of an unsaved edit
- the upload request and `asset_created` carry the planned duration the row already had. `mux webhooks listen` needs a token with the
webhooks permission; a `video:read, video:write` token prints the secret and exits, and README's
"Video Notes" gives the signed-delivery alternative that exercises everything but the transport.

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

## React types across the workspace

Two copies of `@types/react` are correct and must both stay: `apps/mobile` runs react 18.3.1
and pins `^18`, while `apps/diaz-ondemand-web` and `packages/ui` run react 19 and pin `^19`.

`next@15.2.9`, `@clerk/nextjs@6.37.5`, `@clerk/clerk-react@5.60.2` and `@clerk/shared@3.45.1`
each declare `react` as a peer but not `@types/react`, even though their shipped `.d.ts` files
import React types. pnpm therefore links no `@types/react` beside them, and TypeScript falls
through to pnpm's hoisted fallback store, `node_modules/.pnpm/node_modules/@types/react`,
which holds whichever single copy pnpm happened to hoist. When that was the 18 copy, Next's
types built `React.ReactNode` from React 18 while the app built `ReactNode` from React 19 and
`next build` failed at `app/layout.tsx:29`. Clerk reaches that same store from
`@clerk/shared/dist/runtime/react/index.d.mts`, and types the `<ClerkProvider>` children that
`apps/diaz-ondemand-web/components/auth-provider.tsx` passes as React 19 `ReactNode`.
`skipLibCheck` covers none of it, because the mismatch is at the usage site rather than inside
the declaration file. The hoist choice varies between installs, so it looked intermittent.

The `pnpm.packageExtensions` block in the root `package.json` declares that missing peer for
all four, so each resolves `@types/react` from its consumer and never consults the hoisted
store. Treat those entries as instances of a rule, not a fixed list: any dependency whose
shipped `.d.ts` imports React types but omits the `@types/react` peer belongs in the same
block, including a transitive one like `@clerk/shared` that no workspace manifest names. A
dependency that resolves `@types/react` correctly carries an `(@types/react@...)` suffix on
its `pnpm-lock.yaml` snapshot key, whether it declares the peer itself the way
`@mux/mux-player-react` does or gets it from this block; a missing suffix is the signal to
extend the block.

Test the block rather than the current hoist, in a disposable install outside this repository.
Boundaries above forbids mutating `node_modules`, and a real install is half the test anyway:
resolving every dependency against the block and writing the hoisted store is the behaviour
under test, so nothing short of an install proves anything about it. A fresh install still
picks the hoist itself and picked 19 every time this was run, so the adverse case has to be
forced - inside the throwaway copy, where it costs nothing.

```bash
cat > /tmp/react-types-proof.sh <<'PROOF'
set -euo pipefail
repo=$PWD
tmp=$(mktemp -d)
explain=$(mktemp)
trap 'rm -rf "$tmp"' EXIT
git -C "$repo" archive HEAD | tar -x -C "$tmp"
cd "$tmp"
pnpm install --frozen-lockfile
pnpm --filter diaz-ondemand-web... --filter '!diaz-ondemand-web' run build
ln -sfn "$tmp"/node_modules/.pnpm/@types+react@18.*/node_modules/@types/react \
  node_modules/.pnpm/node_modules/@types/react
if ! pnpm --filter diaz-ondemand-web exec tsc --noEmit --explainFiles > "$explain" 2>&1; then
  echo "FAIL: tsc did not complete, see $explain"
  grep -E 'error TS' "$explain" | head -20 || true
  exit 1
fi
if grep -q '@types+react@18' "$explain"; then
  echo "FAIL: the hoisted 18 copy reached the web compilation, see $explain"
  exit 1
fi
rm -f "$explain"
echo PASS
PROOF
bash /tmp/react-types-proof.sh
```

It must print `PASS` and exit 0, and every other outcome is a named failure rather than a bare
exit status. `set -euo pipefail` aborts on the install or the build; a non-zero `tsc` is caught
explicitly, because that is the likely failure and `set -e` alone would end the run silently;
and neither reaches the `grep`, whose own zero-match status is 1 on the outcome you want. The
`grep` is the stricter backstop, for an 18 copy that reaches the compilation without yet
causing a type error. The trap removes the workspace on every exit, while `$explain` survives a
failure so there is something left to read. Build the web app's workspace dependencies first
or `tsc` fails on missing `@diaz/shared` types instead of on React. `git archive HEAD` copies
committed state only, so commit a change to the block before testing it.

Verified 2026-08-05 on pnpm 9.12.3: `PASS`, exit 0. Deleting `pnpm.packageExtensions` from the
temp copy after the archive gives `FAIL: tsc did not complete`, exit 1, and an `$explain`
holding 8 errors and 12 `@types+react@18` matches, the first of them the original
`app/layout.tsx(29,13)`. A green build proves nothing on its own while the 19 copy happens to
be the hoisted one; that is what hid `@clerk/shared`.

Do not replace the block with a workspace-wide `pnpm.overrides` pin of `@types/react`. That
is green on build, lint, typecheck and test today, but it types mobile's react 18.3.1 runtime
with React 19 types, after which mobile's `tsc` accepts `use` and `useActionState`, neither of
which exists at runtime there. Both approaches were verified end to end before choosing.

Turbo's cache is keyed on the lockfile, not on resolved `node_modules`, so a build can replay
from cache after an install that changed resolved `node_modules` without changing the
lockfile. Turbo also shares one cache across git worktrees. Measured on turbo 2.8.10, which
reports `Remote caching disabled, using shared worktree cache`: a worktree holding no
`.turbo/cache` of its own replayed hash `00a2e301a6b5cf13` from an artifact present only in
the primary checkout's `.turbo/cache`. Re-check that after a turbo upgrade, because it
differs from pre-2.8 behaviour and a claim that silently stops being true is worse than none.
The exact route by which the broken state reached `main` was not established. Verify any
dependency-resolution change with `pnpm exec turbo run build --force`. Run `build` and
`typecheck` in separate turbo invocations as CI does: the web `tsconfig.json` includes
`.next/types/**`, which `next build` generates, so one combined invocation races.

## The API on Vercel serverless

`apps/api` serves from two entrypoints and one wiring function. `createApiApp` in
`src/create-app.ts` builds the whole application - CORS, coming-soon wall, validation pipe,
Swagger - and neither entrypoint configures anything itself: `main.ts` calls `listen()`,
`serverless.ts` calls `init()` and exports the Express instance underneath. Add anything
application-wide to `create-app.ts`, never to one entrypoint, or the deployed API and the one
you tested locally stop being the same program. The deploy steps, the pooled `DATABASE_URL`
and the post-deploy checks are in "API Deploy Runbook (Vercel serverless)" in README.md.

Five things here are load-bearing and each looks like tidy-up bait:

- `apps/api/api/index.js` is hand-written JavaScript that only re-exports `dist/serverless.js`.
  Vercel compiles the function entrypoint with esbuild, which cannot emit the decorator metadata
  Nest's DI reads, so nothing Nest must understand may pass through it - `nest build` (tsc)
  produces `dist/`. It also stays outside `src/`, and so outside `tsconfig.json`'s `include`,
  because adding it would move the emitted tree to `dist/api/` + `dist/src/` and break
  `pnpm start`'s `dist/main.js` path.
- `serverless.ts` uses top-level await and exports the Express instance rather than an
  `(req, res)` wrapper. The runtime awaits the entrypoint import, so Nest is initialised before
  the first request instead of racing it, and an invalid environment throws there - the module
  never loads and every invocation fails naming the variable, which is as close as a function
  gets to refusing to open a port. Exporting the Express instance matters because Vercel skips
  its request helpers for a listener with a `listen` method.
- `restoreReadableBody` in `src/serverless-raw-body.ts` is the reason that last point is an
  optimisation and not a dependency. When a runtime reads the request body first, `req.readable`
  goes false; `on-finished` then reports the request finished, body-parser returns without
  calling the `verify` callback that populates `rawBody`, and **every Stripe and Mux delivery
  answers 400** - total failure of the only job the deployment exists for, looking exactly like
  "webhooks just don't work". Reproduced and pinned in `src/tests/serverless-raw-body.test.ts`,
  which drives a real Nest app created with `rawBody: true` through Vercel's own `restoreBody`
  logic and asserts the failure without the middleware and byte-identical recovery with it.
  Vercel's production launcher is injected at deploy time and is in no package installed here,
  so which branch is live cannot be verified from this repository - which is why the middleware
  exists rather than a comment saying it is fine. The `readable` flag it sets tracks the replayed
  stream rather than being pinned true: it goes back to false when the replay ends, or
  `isFinished(req)` stays false forever and body-parser's error branch (`dump()` ->
  `onFinished(req, ...)` -> `next(400)`) waits on a socket close instead of answering.
- `apps/api/public/` is an empty directory held in git by a `.gitkeep`, and `vercel.json` sets
  `outputDirectory` to it. Without both, Vercel's documented fallback serves the Root Directory
  as static output, ahead of `rewrites`, publishing `src/**` and `dist/**` on the API domain.
  That is source disclosure, not a secret leak, and it is unverified - it cannot be measured
  without the owner's Vercel account, which is why an empty static root is preferred over a
  `.vercelignore` that would also strip `src/` from the build source. README's step 7 has the
  `curl` check that settles it on the real deployment.
- Nothing in the code pools database connections; the connection string does. Measured on
  Postgres 17: one instance on a direct URL opens 21 backends (`cpus x 2 + 1`), three instances
  through PgBouncer with `?pgbouncer=true&connection_limit=1` open three. `connection_limit`
  caps one instance, the pooler caps how many instances cost, and neither alone is enough.
  `packages/db/src/client.ts` needs no change for this and did not get one.

A sixth thing is not about the function at all: nothing applies migrations on deploy, so the
API build refuses to build for production against a database that is behind.
`packages/db/prisma/check-migrations.ts` runs `prisma migrate status` and nothing else, wired
into `buildCommand` in `apps/api/vercel.json` - not into `apps/api`'s `build` script, because
that is a turbo task and a cache hit replays its logs rather than running it, so a check placed
there is skipped exactly when the code has not changed and the database is the thing that moved.
Whether a Vercel deploy restores `.turbo` across builds is unverified from here, and
`buildCommand` runs either way. It never applies anything and never creates
`_prisma_migrations`: a gate that fixes things is a gate that silently migrates production
during a build. Production refuses, preview warns, a local build with no `DATABASE_URL` skips.
The web project gets no gate and must not be given one - `apps/diaz-ondemand-web` imports
neither `@diaz/db` nor `PrismaClient`, and `DATABASE_URL` is API-only by policy, so a gate there
would skip in every environment. Behaviour, measurements and the incident that caused it are in
"The migration deploy gate" in README.md; CI asserts both directions, because a gate that has
stopped refusing looks exactly like one with nothing to refuse.

Known and deliberately not worked around: `swagger-ui-dist` contributes only `absolute-path.js`
and `package.json` to a `@vercel/nft` 1.10.0 trace of the entrypoint, so `/docs` will serve its
HTML on Vercel and then fail to load its own CSS and JS. `/docs-json` is generated in-process
and is unaffected. The fix would be an `includeFiles` glob into a pnpm store path that cannot be
verified without deploying, so it is written down instead of guessed at.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
