/**
 * Deploy gate: refuses to build the API for production when the database is
 * behind `packages/db/prisma/migrations`.
 *
 * This exists because the opposite order shipped once. `Entitlement.source`
 * was added by `20260801095656_stripe_billing_lifecycle` on 1 August and was
 * never applied to the production Neon database. Every read path kept working,
 * because reads only touch older stable schema, so the deployment looked
 * healthy for weeks. The first *write* - the first sign-in ever attempted
 * against the deployed API - answered 500 with Prisma P2022, "The column
 * `source` does not exist in the current database". Nothing in `vercel.json`
 * or any package script runs migrations on deploy, deliberately, so code and
 * schema drift apart silently until a user finds the gap.
 *
 * Failing the production build is the point: the deploy is rejected and the
 * previous deployment, which matches the database, stays live. A service that
 * keeps working beats a service that ships and 500s.
 *
 * How hard it is about a database it cannot verify depends on where the build
 * runs - production refuses, a preview warns, a local build without a database
 * skips. That decision is `gateMode()` below, which documents why.
 *
 * READ ONLY. It never applies a migration and never creates `_prisma_migrations`;
 * applying stays `prisma migrate deploy`, run by a human against a named
 * database. `prisma migrate status` is the read: measured on Prisma 6.19.2, it
 * leaves an empty database with no tables at all, and it answers correctly as a
 * role holding only CONNECT/USAGE/SELECT.
 *
 * Two things it deliberately does not do:
 * - It does not read `_prisma_migrations` itself. `prisma migrate status` is
 *   the source of truth Prisma Migrate already maintains, so the gate and
 *   `migrate deploy` cannot disagree about what "applied" means.
 * - It does not report a database that is *ahead* of this checkout. Measured on
 *   6.19.2, `migrate status` says "Database schema is up to date!" and exits 0
 *   when the database holds migrations the checkout does not, so a deliberate
 *   rollback deploys rather than being blocked. Being behind is the failure
 *   this gate exists for.
 *
 * Usage: pnpm db:check   (also runs ahead of the API build - see apps/api/vercel.json)
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(packageDir, 'prisma', 'migrations');
const schemaPath = join('prisma', 'schema.prisma');

/**
 * Resolved rather than left to PATH so the gate behaves the same whether it is
 * run as `pnpm db:check`, which puts `node_modules/.bin` on PATH, or as a bare
 * `tsx prisma/check-migrations.ts`, which does not.
 */
const prismaBin = join(packageDir, 'node_modules', '.bin', 'prisma');

/**
 * Long enough for a cold serverless database to wake, short enough to fail a
 * hung build with a readable error instead of the platform's own timeout.
 */
const STATUS_TIMEOUT_MS = 60_000;

/** What a state the gate cannot verify costs: the build, a warning, or nothing. */
type GateMode = 'fail' | 'warn' | 'skip';

/**
 * How hard to be about a database the gate cannot verify - behind the
 * migrations directory, unreachable, no `DATABASE_URL` at all, or the
 * migrations not visible to the build.
 *
 * Production is the only build members actually reach, so there every one of
 * those states refuses to build: the deploy is rejected and the previous,
 * schema-matching deployment keeps serving.
 *
 * A preview build only warns, and never fails. A pull request that carries a
 * schema change still has to produce a preview someone can open, or the gate
 * blocks review of the unrelated code in that change rather than just the
 * deploy. Preview is also where `DATABASE_URL` is most often simply absent: a
 * variable scoped to Production only is in no other environment's build.
 *
 * Off Vercel, no `DATABASE_URL` means no database is configured and there is
 * nothing to compare - a contributor building without Postgres, not a deploy.
 * Set it and the build is meant for a real database, so the gate is back on.
 */
function gateMode(env: NodeJS.ProcessEnv): GateMode {
  if (env.VERCEL_ENV === 'production') return 'fail';
  if (env.VERCEL) return 'warn';
  return env.DATABASE_URL ? 'fail' : 'skip';
}

/**
 * Whether `SKIP_MIGRATION_CHECK` is asking for the gate to be off.
 *
 * Only "1" and "true" count. Anything else - "0" and "false" above all - reads
 * as someone spelling out that the check should run, and a guard that turns
 * itself off when told to stay on is the worst possible reading of that.
 */
function skipRequested(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

/**
 * Which database a connection string points at, as `host/database`.
 * Deliberately partial: the password and the whole query string stay out, so
 * this is safe in a build log a stranger can read.
 *
 * Printed before anything else, because "which database am I pointed at" has to
 * be answerable by reading one line of output.
 */
function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    return `${parsed.host}/${database || '(default database)'}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/**
 * The migrations `prisma migrate status` named as not yet applied.
 *
 * Enrichment only: the exit code is what decides, so a wording change upstream
 * costs the gate the list of names, never the refusal.
 */
function pendingMigrations(output: string): string[] {
  const lines = output.split('\n');
  const start = lines.findIndex((line) => /have not yet been applied/.test(line));
  if (start === -1) return [];

  const pending: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const name = line.trim();
    if (!name) break;
    pending.push(name);
  }
  return pending;
}

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/**
 * Reports a state the gate could not verify, at the severity this build
 * environment calls for. It returns when the environment only warns, and there
 * is never anything left to check after one of these, so every caller stops.
 */
function report(mode: GateMode, message: string): void {
  if (mode === 'fail') fail(message);
  console.warn(`\n! ${message}\n`);
}

function main(): void {
  const skipFlag = process.env.SKIP_MIGRATION_CHECK;
  if (skipRequested(skipFlag)) {
    console.warn(
      '! migration check skipped by SKIP_MIGRATION_CHECK - this build may need a schema the database does not have',
    );
    return;
  }
  if (skipFlag?.trim()) {
    console.warn(
      `! SKIP_MIGRATION_CHECK=${skipFlag} ignored - only "1" or "true" turns the gate off, so it stays on`,
    );
  }

  const mode = gateMode(process.env);
  if (mode === 'skip') {
    console.log('migration check skipped: DATABASE_URL is not set');
    return;
  }

  // The migrations live outside apps/api, which is the API project's Vercel
  // Root Directory. They are visible because "Include source files outside of
  // the Root Directory in the Build Step" is on - the same setting the
  // workspace install already depends on. If it is ever turned off the gate
  // would have nothing to compare against, and a gate that quietly disables
  // itself is worse than none. Say so, and name the setting.
  if (!existsSync(migrationsDir)) {
    report(
      mode,
      `cannot find the migrations directory at ${migrationsDir}\n` +
        `  On Vercel this means the build cannot see files outside the Root Directory:\n` +
        `  Settings -> General -> Root Directory -> "Include source files outside of the\n` +
        `  Root Directory in the Build Step" must stay enabled.`,
    );
    return;
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    report(
      mode,
      `DATABASE_URL is not set, so this build's database cannot be checked at all.\n` +
        `  On Vercel, set it for the environment being built:\n` +
        `  Settings -> Environment Variables. One scoped to Production only is absent\n` +
        `  from every preview build.`,
    );
    return;
  }

  const target = describeTarget(url);
  console.log(`migration check target: ${target}`);

  // DATABASE_URL is passed through explicitly so the child checks the database
  // this line just named. Prisma otherwise loads a `.env` from its working
  // directory, and the gate must not report on one database while the build
  // deploys against another.
  const status = spawnSync(prismaBin, ['migrate', 'status', '--schema', schemaPath], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    timeout: STATUS_TIMEOUT_MS,
  });

  if (status.error) {
    report(
      mode,
      `could not run prisma migrate status against ${target}: ${status.error.message}\n` +
        `  DATABASE_URL is set, so this build is meant for a real database and cannot be checked.`,
    );
    return;
  }

  const output = `${status.stdout ?? ''}${status.stderr ?? ''}`.trimEnd();

  if (status.status === 0) {
    console.log(`migration check ok: every migration is applied to ${target}`);
    return;
  }

  const pending = pendingMigrations(output);
  if (pending.length === 0) {
    report(
      mode,
      `could not verify the schema of ${target} - prisma migrate status exited ${status.status}:\n\n` +
        `${output}\n`,
    );
    return;
  }

  report(
    mode,
    `${target} is behind packages/db/prisma/migrations - ${pending.length} migration(s) not applied:\n` +
      pending.map((name) => `      ${name}`).join('\n') +
      `\n\n  Apply them to that same database first, then deploy:\n` +
      `      DATABASE_URL='postgresql://USER:PASSWORD@DIRECT-HOST:5432/DB?schema=public' \\\n` +
      `        pnpm --filter @diaz/db exec prisma migrate deploy --schema prisma/schema.prisma\n\n` +
      `  Migrations do not go through the pooler, so that has to be the DIRECT connection\n` +
      `  string, not the pooled one this build is configured with: on Neon the hostname\n` +
      `  WITHOUT "-pooler", on Supabase port 5432 rather than 6543.\n\n` +
      `  Deploying this build would answer HTTP 500 from every path that needs the missing\n` +
      `  schema. Reads keep working - that is why the last gap went unnoticed for weeks.\n` +
      `  Override with SKIP_MIGRATION_CHECK=1 only if you know why.`,
  );
}

main();
