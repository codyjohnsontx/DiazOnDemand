import { z } from 'zod';

const LOOPBACK_DB_HOSTS = new Set(['localhost', '::1']);

/**
 * True only when DATABASE_URL points at a database on this machine.
 *
 * The dev auth bypass authenticates a request carrying no credentials at all as
 * the seeded ADMIN/PREMIUM user, so it must never be reachable on a deployed
 * server. NODE_ENV cannot be trusted to tell us where we are running - the only
 * thing in this repository that sets it is the `pnpm start` script, so a run
 * that does not go through that script, on a host that does not export it,
 * leaves every `NODE_ENV === 'production'` guard inert. The database a process is
 * pointed at is a fact about the deployment rather than a hint, so that is what
 * gates the bypass. Anything unparseable or non-loopback fails closed.
 */
export function isLoopbackDatabaseUrl(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) {
    return false;
  }

  let hostname: string;

  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    return false;
  }

  // URL keeps IPv6 hosts wrapped in brackets.
  const host = hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();

  return LOOPBACK_DB_HOSTS.has(host) || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/**
 * The single predicate for whether the dev auth bypass may be used. Startup
 * validation refuses the same combination outright, so a server should never
 * reach this - it is the request-time half of the same fail-closed rule.
 */
export function isDevAuthBypassEnabled(source: NodeJS.ProcessEnv): boolean {
  return (
    source.NODE_ENV !== 'production' &&
    source.DEV_BYPASS_AUTH === 'true' &&
    isLoopbackDatabaseUrl(source.DATABASE_URL)
  );
}

/**
 * Whether this process is a deployment rather than a developer's machine.
 *
 * The single answer used by both halves of the unsigned-playback rule: startup
 * validation refuses to boot a deployment without the signing key pair, and
 * `isUnsignedPaidPlaybackAllowed` refuses the unsigned fallback on one. Those
 * two must never disagree, so they ask one function rather than two copies of
 * an expression - copies drift, and this is the check standing between a
 * deployed service and serving unsigned paid video.
 *
 * Takes the two values rather than a whole environment so the startup site can
 * pass its parsed fields directly without the coerced numeric `PORT` having to
 * fit `NodeJS.ProcessEnv`. Anything unparseable or non-loopback counts as a
 * deployment, so it fails closed.
 */
export function isDeployment(
  nodeEnv: string | undefined,
  databaseUrl: string | undefined,
): boolean {
  return nodeEnv === 'production' || !isLoopbackDatabaseUrl(databaseUrl);
}

/**
 * Whether a PAID lesson may fall back to an unsigned playback url when no Mux
 * signing key is configured - see mapLessonDetail in
 * apps/api/src/content/lesson-presentation.ts.
 *
 * Gated on the same fact, and for the same reason, as the dev auth bypass
 * above. An unsigned `stream.mux.com/<id>.m3u8` never expires and asks for
 * nothing, so on a public asset it hands the paid catalogue to anyone who reads
 * the url. That must not become reachable because a host happened to run
 * `node dist/main.js` instead of `pnpm start` and so left NODE_ENV unset. The
 * database a process is pointed at is a fact about the deployment, so that is
 * what decides whether this is a developer's machine.
 */
export function isUnsignedPaidPlaybackAllowed(source: NodeJS.ProcessEnv): boolean {
  return !isDeployment(source.NODE_ENV, source.DATABASE_URL);
}

const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.string().default('http://localhost:3000,http://localhost:8081'),
    WEB_APP_URL: z.string().url().default('http://localhost:3000'),
    DEV_BYPASS_AUTH: z.enum(['true', 'false']).default('false'),
    DEFAULT_DEV_CLERK_USER_ID: z.string().default('dev_clerk_user'),
    CLERK_SECRET_KEY: z.string().optional(),
    CLERK_JWT_ISSUER: z.string().url().optional(),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_PRICE_ID_MONTHLY: z.string().optional(),
    MUX_TOKEN_ID: z.string().optional(),
    MUX_TOKEN_SECRET: z.string().optional(),
    MUX_WEBHOOK_SECRET: z.string().optional(),
    MUX_SIGNING_KEY_ID: z.string().optional(),
    MUX_SIGNING_KEY_PRIVATE: z.string().optional(),
    DIAZ_INTERNAL_API_KEY: z.string().optional(),
    // Optional Slack/Discord-style incoming webhook. When unset, billing alerts
    // are logged only - see apps/api/src/billing/billing-alerter.ts.
    BILLING_ALERT_WEBHOOK_URL: z.string().url().optional(),
    VOD_COMING_SOON: z.enum(['true', 'false']).default('false'),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === 'production' && value.DEV_BYPASS_AUTH === 'true') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_BYPASS_AUTH'],
        message: 'must be false in production',
      });
    }

    // Refusing on the database rather than on NODE_ENV is what makes this
    // impossible to leave on by accident: a process pointed at a real database
    // cannot start with the bypass enabled no matter what NODE_ENV says.
    if (value.DEV_BYPASS_AUTH === 'true' && !isLoopbackDatabaseUrl(value.DATABASE_URL)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DEV_BYPASS_AUTH'],
        message:
          'must be false unless DATABASE_URL points at a loopback host - localhost, any 127.x.x.x address such as 127.0.0.1, or the IPv6 loopback written as [::1] - because the bypass authenticates uncredentialed requests as an admin, so it may only run against a local database',
      });
    }

    if (value.DEV_BYPASS_AUTH === 'false' && !value.CLERK_SECRET_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLERK_SECRET_KEY'],
        message: 'required when DEV_BYPASS_AUTH=false',
      });
    }

    if (value.DEV_BYPASS_AUTH === 'false' && !value.CLERK_JWT_ISSUER) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CLERK_JWT_ISSUER'],
        message: 'required when DEV_BYPASS_AUTH=false',
      });
    }

    if (value.STRIPE_SECRET_KEY && !value.STRIPE_PRICE_ID_MONTHLY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_PRICE_ID_MONTHLY'],
        message: 'required when STRIPE_SECRET_KEY is set',
      });
    }

    if (
      value.NODE_ENV === 'production' &&
      value.STRIPE_SECRET_KEY &&
      !value.STRIPE_WEBHOOK_SECRET
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_WEBHOOK_SECRET'],
        message: 'required in production when Stripe billing is enabled',
      });
    }

    if (value.STRIPE_WEBHOOK_SECRET && !value.STRIPE_SECRET_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['STRIPE_SECRET_KEY'],
        message: 'required when STRIPE_WEBHOOK_SECRET is set',
      });
    }

    if ((value.MUX_TOKEN_ID && !value.MUX_TOKEN_SECRET) || (!value.MUX_TOKEN_ID && value.MUX_TOKEN_SECRET)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MUX_TOKEN_ID'],
        message: 'MUX_TOKEN_ID and MUX_TOKEN_SECRET must be provided together',
      });
    }

    if (value.NODE_ENV === 'production' && value.MUX_TOKEN_ID && !value.MUX_WEBHOOK_SECRET) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MUX_WEBHOOK_SECRET'],
        message: 'required in production when Mux is enabled',
      });
    }

    if (
      (value.MUX_SIGNING_KEY_ID && !value.MUX_SIGNING_KEY_PRIVATE) ||
      (!value.MUX_SIGNING_KEY_ID && value.MUX_SIGNING_KEY_PRIVATE)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MUX_SIGNING_KEY_ID'],
        message: 'MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE must be provided together',
      });
    }

    // Signed playback is what gates PAID lessons, so a deployment must be able
    // to mint tokens rather than falling back to an unsigned url. Refusing on
    // the database as well as on NODE_ENV is what makes that hold for a server
    // started without NODE_ENV set - the same reasoning as the bypass above.
    //
    // Deliberately keyed on the deployment alone, with no "is Mux enabled"
    // proxy. This used to be gated on MUX_TOKEN_ID, which drifted: no runtime
    // code reads that variable, so a deployment that serves Mux video without
    // ever setting it skipped the check entirely and every PAID lesson answered
    // 500 with no boot-time signal. Any proxy can drift the same way. The
    // signing key pair cannot, because what is required here is exactly what
    // createMuxPlaybackToken reads, and it is the only thing standing between a
    // PAID lesson and either a 500 or an unsigned url. A deployed API can never
    // serve paid Mux video without it, so there is no configuration in which
    // the requirement is wrong - the same unconditional shape as the
    // DIAZ_INTERNAL_API_KEY production requirement below.
    if (
      isDeployment(value.NODE_ENV, value.DATABASE_URL) &&
      (!value.MUX_SIGNING_KEY_ID || !value.MUX_SIGNING_KEY_PRIVATE)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MUX_SIGNING_KEY_ID'],
        message:
          'required on a deployment together with MUX_SIGNING_KEY_PRIVATE - a deployment being NODE_ENV=production, or a DATABASE_URL that is not loopback - because the pair signs PAID lesson playback, and without it a paid lesson is served over an unsigned, non-expiring url or not served at all',
      });
    }

    if (value.NODE_ENV === 'production' && !value.DIAZ_INTERNAL_API_KEY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['DIAZ_INTERNAL_API_KEY'],
        message: 'required in production for server-to-server entitlement checks',
      });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function validateApiEnv(source: NodeJS.ProcessEnv): ApiEnv {
  const parsed = apiEnvSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid API environment variables: ${details}`);
  }

  return parsed.data;
}
