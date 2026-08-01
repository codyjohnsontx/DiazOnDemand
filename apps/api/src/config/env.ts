import { z } from 'zod';

const LOOPBACK_DB_HOSTS = new Set(['localhost', '::1', '0:0:0:0:0:0:0:1']);

/**
 * True only when DATABASE_URL points at a database on this machine.
 *
 * The dev auth bypass authenticates a request carrying no credentials at all as
 * the seeded ADMIN/PREMIUM user, so it must never be reachable on a deployed
 * server. NODE_ENV cannot be trusted to tell us where we are running - nothing
 * in this repository sets it, so a host that happens not to export it leaves
 * every `NODE_ENV === 'production'` guard inert. The database a process is
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
          'must be false unless DATABASE_URL points at localhost - the bypass authenticates uncredentialed requests as an admin, so it may only run against a local database',
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

    // Signed playback is what gates PAID lessons, so production must be able to
    // mint tokens rather than falling back to an unsigned url.
    if (value.NODE_ENV === 'production' && value.MUX_TOKEN_ID && !value.MUX_SIGNING_KEY_ID) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MUX_SIGNING_KEY_ID'],
        message: 'required in production when Mux is enabled (signs PAID lesson playback)',
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
