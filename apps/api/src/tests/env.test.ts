import { describe, expect, it } from 'vitest';
import {
  isDeployment,
  isDevAuthBypassEnabled,
  isLoopbackDatabaseUrl,
  isUnsignedPaidPlaybackAllowed,
  validateApiEnv,
} from '../config/env.js';

const LOCAL_DB = 'postgresql://postgres:postgres@localhost:5432/diaz_ondemand';
const REMOTE_DB = 'postgresql://app:secret@db.example.com:5432/diaz_ondemand';

function envWithoutBypass(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: LOCAL_DB,
    DEV_BYPASS_AUTH: 'false',
    CLERK_SECRET_KEY: 'sk_test_key',
    CLERK_JWT_ISSUER: 'https://tenant.clerk.accounts.dev',
    ...overrides,
  };
}

describe('isLoopbackDatabaseUrl', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopbackDatabaseUrl(LOCAL_DB)).toBe(true);
    expect(isLoopbackDatabaseUrl('postgresql://u:p@127.0.0.1:5432/db')).toBe(true);
    expect(isLoopbackDatabaseUrl('postgresql://u:p@127.1.2.3:5432/db')).toBe(true);
    expect(isLoopbackDatabaseUrl('postgres://u:p@[::1]:5432/db?schema=public')).toBe(true);
    expect(isLoopbackDatabaseUrl('postgresql://u:p@LOCALHOST:5432/db')).toBe(true);
  });

  it('fails closed on anything else', () => {
    expect(isLoopbackDatabaseUrl(REMOTE_DB)).toBe(false);
    expect(isLoopbackDatabaseUrl('postgresql://u:p@10.0.0.4:5432/db')).toBe(false);
    // A host that merely looks local must not count.
    expect(isLoopbackDatabaseUrl('postgresql://u:p@localhost.example.com:5432/db')).toBe(false);
    expect(isLoopbackDatabaseUrl('not-a-url')).toBe(false);
    expect(isLoopbackDatabaseUrl('')).toBe(false);
    expect(isLoopbackDatabaseUrl(undefined)).toBe(false);
  });
});

describe('dev auth bypass startup refusal', () => {
  it('refuses the bypass against a non-local database with NODE_ENV unset', () => {
    expect(() =>
      validateApiEnv({ DATABASE_URL: REMOTE_DB, DEV_BYPASS_AUTH: 'true' }),
    ).toThrow(/DEV_BYPASS_AUTH.*DATABASE_URL points at a loopback host.*127\.0\.0\.1.*\[::1\]/s);
  });

  it('refuses the bypass against a non-local database in development and test', () => {
    for (const NODE_ENV of ['development', 'test']) {
      expect(() =>
        validateApiEnv({ NODE_ENV, DATABASE_URL: REMOTE_DB, DEV_BYPASS_AUTH: 'true' }),
      ).toThrow(/DEV_BYPASS_AUTH/);
    }
  });

  it('still refuses the bypass in production, even against a local database', () => {
    expect(() =>
      validateApiEnv({
        NODE_ENV: 'production',
        DATABASE_URL: LOCAL_DB,
        DEV_BYPASS_AUTH: 'true',
        DIAZ_INTERNAL_API_KEY: 'internal',
      }),
    ).toThrow(/DEV_BYPASS_AUTH: must be false in production/);
  });

  it('allows the bypass against a local database', () => {
    const env = validateApiEnv({ DATABASE_URL: LOCAL_DB, DEV_BYPASS_AUTH: 'true' });

    expect(env.DEV_BYPASS_AUTH).toBe('true');
    expect(env.NODE_ENV).toBe('development');
  });
});

describe('isDevAuthBypassEnabled', () => {
  it('is false against a non-local database whatever NODE_ENV says', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      expect(
        isDevAuthBypassEnabled({ NODE_ENV, DATABASE_URL: REMOTE_DB, DEV_BYPASS_AUTH: 'true' }),
      ).toBe(false);
    }
  });

  it('is false in production and when the flag is off', () => {
    expect(
      isDevAuthBypassEnabled({
        NODE_ENV: 'production',
        DATABASE_URL: LOCAL_DB,
        DEV_BYPASS_AUTH: 'true',
      }),
    ).toBe(false);
    expect(isDevAuthBypassEnabled({ DATABASE_URL: LOCAL_DB, DEV_BYPASS_AUTH: 'false' })).toBe(
      false,
    );
    expect(isDevAuthBypassEnabled({ DATABASE_URL: LOCAL_DB })).toBe(false);
  });

  it('is true for local development', () => {
    expect(isDevAuthBypassEnabled({ DATABASE_URL: LOCAL_DB, DEV_BYPASS_AUTH: 'true' })).toBe(true);
    expect(
      isDevAuthBypassEnabled({
        NODE_ENV: 'development',
        DATABASE_URL: LOCAL_DB,
        DEV_BYPASS_AUTH: 'true',
      }),
    ).toBe(true);
  });
});

describe('isUnsignedPaidPlaybackAllowed', () => {
  it('is false against a deployed database whatever NODE_ENV says', () => {
    for (const NODE_ENV of [undefined, 'development', 'test', 'production']) {
      expect(isUnsignedPaidPlaybackAllowed({ NODE_ENV, DATABASE_URL: REMOTE_DB })).toBe(false);
    }
  });

  it('fails closed when there is no DATABASE_URL to judge by', () => {
    expect(isUnsignedPaidPlaybackAllowed({})).toBe(false);
    expect(isUnsignedPaidPlaybackAllowed({ DATABASE_URL: 'not-a-url' })).toBe(false);
  });

  it('is false in production, even against a local database', () => {
    expect(isUnsignedPaidPlaybackAllowed({ NODE_ENV: 'production', DATABASE_URL: LOCAL_DB })).toBe(
      false,
    );
  });

  it('is true for local development, so a developer can still watch a paid lesson', () => {
    expect(isUnsignedPaidPlaybackAllowed({ DATABASE_URL: LOCAL_DB })).toBe(true);
    expect(isUnsignedPaidPlaybackAllowed({ NODE_ENV: 'development', DATABASE_URL: LOCAL_DB })).toBe(
      true,
    );
  });
});

/**
 * The places that decide "is this a deployment" must never disagree: one lets a
 * PAID lesson fall back to an unsigned url, one refuses to boot without the key
 * that signs it, and one lets an uncredentialed request through as an admin.
 * They were written as separate expressions, so this pins the full matrix at
 * every call site rather than trusting that the spellings mean the same thing.
 *
 * The deployment answer is asserted here as a literal per row, so the table is
 * a fixed expectation of behaviour rather than a restatement of whatever the
 * predicate currently returns.
 */
const DEPLOYMENT_MATRIX: { databaseUrl: string | undefined; deployedWhenNotProduction: boolean }[] =
  [
    { databaseUrl: LOCAL_DB, deployedWhenNotProduction: false },
    { databaseUrl: 'postgresql://u:p@127.0.0.1:5432/db', deployedWhenNotProduction: false },
    { databaseUrl: 'postgresql://u:p@127.9.9.9:5432/db', deployedWhenNotProduction: false },
    { databaseUrl: 'postgres://u:p@[::1]:5432/db?schema=public', deployedWhenNotProduction: false },
    { databaseUrl: 'postgresql://u:p@LOCALHOST:5432/db', deployedWhenNotProduction: false },
    { databaseUrl: REMOTE_DB, deployedWhenNotProduction: true },
    { databaseUrl: 'postgresql://u:p@10.0.0.4:5432/db', deployedWhenNotProduction: true },
    { databaseUrl: 'postgresql://u:p@localhost.example.com:5432/db', deployedWhenNotProduction: true },
    { databaseUrl: 'not-a-url', deployedWhenNotProduction: true },
    { databaseUrl: '', deployedWhenNotProduction: true },
    { databaseUrl: undefined, deployedWhenNotProduction: true },
  ];

const NODE_ENVS = [undefined, 'development', 'test', 'production'] as const;

/** True when validateApiEnv refuses for the rule whose message contains `reason`. */
function refusesFor(env: NodeJS.ProcessEnv, reason: string): boolean {
  try {
    validateApiEnv(env);
    return false;
  } catch (error) {
    return (error as Error).message.includes(reason);
  }
}

/** True when validateApiEnv refuses specifically for the deployment signing-key rule. */
function refusesForDeploymentSigningKey(env: NodeJS.ProcessEnv): boolean {
  return refusesFor(env, 'required on a deployment together with MUX_SIGNING_KEY_PRIVATE');
}

/**
 * The startup requirements that used to read `NODE_ENV === 'production'` and now
 * ask the deployment predicate instead. Each names the extra environment that
 * has to be present for its own rule to be the one under test, so a row fails
 * because of the variable it is about rather than because of a sibling rule.
 */
const DEPLOYMENT_REQUIREMENTS: {
  name: string;
  reason: string;
  satisfy: NodeJS.ProcessEnv;
  otherwiseComplete: NodeJS.ProcessEnv;
}[] = [
  {
    name: 'MUX_WEBHOOK_SECRET',
    reason: 'MUX_WEBHOOK_SECRET: required on a deployment',
    satisfy: { MUX_WEBHOOK_SECRET: 'whsec_mux' },
    otherwiseComplete: {
      DIAZ_INTERNAL_API_KEY: 'internal',
      MUX_SIGNING_KEY_ID: 'key',
      MUX_SIGNING_KEY_PRIVATE: 'private',
    },
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    reason: 'STRIPE_WEBHOOK_SECRET: required on a deployment when Stripe billing is enabled',
    satisfy: { STRIPE_WEBHOOK_SECRET: 'whsec_stripe' },
    otherwiseComplete: {
      DIAZ_INTERNAL_API_KEY: 'internal',
      MUX_WEBHOOK_SECRET: 'whsec_mux',
      MUX_SIGNING_KEY_ID: 'key',
      MUX_SIGNING_KEY_PRIVATE: 'private',
      STRIPE_SECRET_KEY: 'sk_live',
      STRIPE_PRICE_ID_MONTHLY: 'price_monthly',
    },
  },
  {
    name: 'DIAZ_INTERNAL_API_KEY',
    reason: 'DIAZ_INTERNAL_API_KEY: required on a deployment',
    satisfy: { DIAZ_INTERNAL_API_KEY: 'internal' },
    otherwiseComplete: {
      MUX_WEBHOOK_SECRET: 'whsec_mux',
      MUX_SIGNING_KEY_ID: 'key',
      MUX_SIGNING_KEY_PRIVATE: 'private',
    },
  },
];

describe('the deployment predicate, at every call site', () => {
  it('answers the whole matrix as the shared predicate', () => {
    for (const nodeEnv of NODE_ENVS) {
      for (const { databaseUrl, deployedWhenNotProduction } of DEPLOYMENT_MATRIX) {
        expect(
          isDeployment(nodeEnv, databaseUrl),
          `NODE_ENV=${nodeEnv ?? '<unset>'} DATABASE_URL=${databaseUrl ?? '<unset>'}`,
        ).toBe(nodeEnv === 'production' || deployedWhenNotProduction);
      }
    }
  });

  it('answers the whole matrix identically at the request-time call site', () => {
    for (const nodeEnv of NODE_ENVS) {
      for (const { databaseUrl, deployedWhenNotProduction } of DEPLOYMENT_MATRIX) {
        const deployed = nodeEnv === 'production' || deployedWhenNotProduction;

        // The request-time site allows the unsigned fallback exactly when this
        // is NOT a deployment.
        expect(
          isUnsignedPaidPlaybackAllowed({ NODE_ENV: nodeEnv, DATABASE_URL: databaseUrl }),
          `NODE_ENV=${nodeEnv ?? '<unset>'} DATABASE_URL=${databaseUrl ?? '<unset>'}`,
        ).toBe(!deployed);
      }
    }
  });

  it('answers the whole matrix identically at the dev auth bypass call site', () => {
    for (const nodeEnv of NODE_ENVS) {
      for (const { databaseUrl, deployedWhenNotProduction } of DEPLOYMENT_MATRIX) {
        const deployed = nodeEnv === 'production' || deployedWhenNotProduction;
        const label = `NODE_ENV=${nodeEnv ?? '<unset>'} DATABASE_URL=${databaseUrl ?? '<unset>'}`;

        // The bypass is allowed exactly when this is NOT a deployment and the
        // flag is on. Nothing else may turn it on.
        expect(
          isDevAuthBypassEnabled({
            NODE_ENV: nodeEnv,
            DATABASE_URL: databaseUrl,
            DEV_BYPASS_AUTH: 'true',
          }),
          `${label} DEV_BYPASS_AUTH=true`,
        ).toBe(!deployed);

        expect(
          isDevAuthBypassEnabled({
            NODE_ENV: nodeEnv,
            DATABASE_URL: databaseUrl,
            DEV_BYPASS_AUTH: 'false',
          }),
          `${label} DEV_BYPASS_AUTH=false`,
        ).toBe(false);
      }
    }
  });

  it('answers the whole matrix identically at the startup call site', () => {
    for (const nodeEnv of NODE_ENVS) {
      for (const { databaseUrl, deployedWhenNotProduction } of DEPLOYMENT_MATRIX) {
        const deployed = nodeEnv === 'production' || deployedWhenNotProduction;
        const label = `NODE_ENV=${nodeEnv ?? '<unset>'} DATABASE_URL=${databaseUrl ?? '<unset>'}`;
        const env = envWithoutBypass({
          NODE_ENV: nodeEnv,
          DATABASE_URL: databaseUrl,
          DIAZ_INTERNAL_API_KEY: 'internal',
        });

        // An absent DATABASE_URL fails the field rule fatally, so superRefine
        // never runs and the startup site is unreachable - which is why the
        // request-time site has to fail closed on its own rather than lean on
        // this one. An *empty* DATABASE_URL is not the same case: min(1) is a
        // non-fatal issue, so superRefine still runs and still refuses. Both
        // are pinned here because the difference is not obvious from the schema.
        if (databaseUrl === undefined) {
          expect(refusesForDeploymentSigningKey(env), label).toBe(false);
          expect(() => validateApiEnv(env), label).toThrow(/DATABASE_URL/);
          continue;
        }

        expect(refusesForDeploymentSigningKey(env), label).toBe(deployed);
      }
    }
  });

  it.each(DEPLOYMENT_REQUIREMENTS)(
    'answers the whole matrix identically at the $name startup requirement',
    ({ reason, satisfy, otherwiseComplete }) => {
      for (const nodeEnv of NODE_ENVS) {
        for (const { databaseUrl, deployedWhenNotProduction } of DEPLOYMENT_MATRIX) {
          const deployed = nodeEnv === 'production' || deployedWhenNotProduction;
          const label = `NODE_ENV=${nodeEnv ?? '<unset>'} DATABASE_URL=${databaseUrl ?? '<unset>'}`;
          const env = envWithoutBypass({
            NODE_ENV: nodeEnv,
            DATABASE_URL: databaseUrl,
            ...otherwiseComplete,
          });

          // An absent DATABASE_URL is fatal at the field rule, so superRefine
          // never runs and no deployment requirement is reachable - the same
          // hole spelled out at the signing-key call site above.
          if (databaseUrl === undefined) {
            expect(refusesFor(env, reason), label).toBe(false);
            continue;
          }

          expect(refusesFor(env, reason), label).toBe(deployed);
          expect(refusesFor({ ...env, ...satisfy }, reason), `${label} satisfied`).toBe(false);
        }
      }
    },
  );

  it('leaves the two sites exact complements wherever both are reachable', () => {
    for (const nodeEnv of NODE_ENVS) {
      for (const { databaseUrl } of DEPLOYMENT_MATRIX) {
        if (databaseUrl === undefined) {
          continue;
        }

        const label = `NODE_ENV=${nodeEnv ?? '<unset>'} DATABASE_URL=${databaseUrl || '<empty>'}`;
        const startupRefuses = refusesForDeploymentSigningKey(
          envWithoutBypass({
            NODE_ENV: nodeEnv,
            DATABASE_URL: databaseUrl,
            DIAZ_INTERNAL_API_KEY: 'internal',
          }),
        );
        const requestTimeAllows = isUnsignedPaidPlaybackAllowed({
          NODE_ENV: nodeEnv,
          DATABASE_URL: databaseUrl,
        });

        expect(requestTimeAllows, label).toBe(!startupRefuses);
      }
    }
  });
});

describe('Mux signing key startup refusal', () => {
  it('refuses a deployed database without signing keys, NODE_ENV unset', () => {
    expect(() => validateApiEnv(envWithoutBypass({ DATABASE_URL: REMOTE_DB }))).toThrow(
      /MUX_SIGNING_KEY_ID: required on a deployment together with MUX_SIGNING_KEY_PRIVATE/,
    );
  });

  // The refusal is keyed on the deployment, never on an "is Mux enabled" proxy:
  // MUX_TOKEN_ID is read only by the pairing rule, never by a serving path, so a
  // deployment can serve Mux video without it and would otherwise slip past this
  // check.
  it('refuses a deployed database with no Mux access token set at all', () => {
    expect(() =>
      validateApiEnv(envWithoutBypass({ DATABASE_URL: REMOTE_DB, MUX_WEBHOOK_SECRET: 'whsec' })),
    ).toThrow(/MUX_SIGNING_KEY_ID: required on a deployment/);
  });

  it('refuses a deployed database that sets only half the signing key pair', () => {
    expect(() =>
      validateApiEnv(envWithoutBypass({ DATABASE_URL: REMOTE_DB, MUX_SIGNING_KEY_ID: 'key' })),
    ).toThrow(/MUX_SIGNING_KEY_ID: required on a deployment/);
  });

  it('accepts a deployed database once the signing key pair is set', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          DATABASE_URL: REMOTE_DB,
          MUX_SIGNING_KEY_ID: 'key',
          MUX_SIGNING_KEY_PRIVATE: 'private',
          MUX_WEBHOOK_SECRET: 'whsec_mux',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).not.toThrow();
  });

  it('still lets a developer run Mux against a local database without signing keys', () => {
    expect(() =>
      validateApiEnv(envWithoutBypass({ MUX_TOKEN_ID: 'token', MUX_TOKEN_SECRET: 'secret' })),
    ).not.toThrow();
  });
});

describe('existing startup refusals', () => {
  it('requires DATABASE_URL', () => {
    expect(() => validateApiEnv({ DEV_BYPASS_AUTH: 'true' })).toThrow(/DATABASE_URL/);
  });

  it('requires Clerk credentials when the bypass is off', () => {
    expect(() =>
      validateApiEnv(envWithoutBypass({ CLERK_SECRET_KEY: undefined })),
    ).toThrow(/CLERK_SECRET_KEY: required when DEV_BYPASS_AUTH=false/);
    expect(() =>
      validateApiEnv(envWithoutBypass({ CLERK_JWT_ISSUER: undefined })),
    ).toThrow(/CLERK_JWT_ISSUER: required when DEV_BYPASS_AUTH=false/);
  });

  it('requires a monthly price when Stripe is enabled', () => {
    expect(() => validateApiEnv(envWithoutBypass({ STRIPE_SECRET_KEY: 'sk_live' }))).toThrow(
      /STRIPE_PRICE_ID_MONTHLY: required when STRIPE_SECRET_KEY is set/,
    );
  });

  it('requires a Stripe webhook secret on a deployment', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          NODE_ENV: 'production',
          STRIPE_SECRET_KEY: 'sk_live',
          STRIPE_PRICE_ID_MONTHLY: 'price_monthly',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).toThrow(/STRIPE_WEBHOOK_SECRET: required on a deployment when Stripe billing is enabled/);
  });

  it('does not require a Stripe webhook secret when Stripe billing is off', () => {
    // STRIPE_SECRET_KEY is what BillingService and WebhooksService construct the
    // Stripe client from, so it is a condition the runtime genuinely defines.
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          DATABASE_URL: REMOTE_DB,
          MUX_WEBHOOK_SECRET: 'whsec_mux',
          MUX_SIGNING_KEY_ID: 'key',
          MUX_SIGNING_KEY_PRIVATE: 'private',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).not.toThrow();
  });

  it('requires Mux credentials and signing keys to be paired', () => {
    expect(() => validateApiEnv(envWithoutBypass({ MUX_TOKEN_ID: 'token' }))).toThrow(
      /MUX_TOKEN_ID and MUX_TOKEN_SECRET must be provided together/,
    );
    expect(() => validateApiEnv(envWithoutBypass({ MUX_SIGNING_KEY_ID: 'key' }))).toThrow(
      /MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE must be provided together/,
    );
  });

  it('requires Mux webhook and signing configuration on a deployment', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          NODE_ENV: 'production',
          MUX_TOKEN_ID: 'token',
          MUX_TOKEN_SECRET: 'secret',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).toThrow(/MUX_WEBHOOK_SECRET: required on a deployment/);

    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          NODE_ENV: 'production',
          MUX_TOKEN_ID: 'token',
          MUX_TOKEN_SECRET: 'secret',
          MUX_WEBHOOK_SECRET: 'whsec',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).toThrow(/MUX_SIGNING_KEY_ID: required on a deployment together with MUX_SIGNING_KEY_PRIVATE/);
  });

  // MUX_TOKEN_ID used to gate the webhook secret, and it is not a reliable signal
  // that Mux webhooks are wired - only the pairing rule reads it - so a deployment
  // that set neither passed. It is the same drift the signing key rule was rescued
  // from, one rule over.
  it('requires the Mux webhook secret on a deployment that sets no Mux access token', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          NODE_ENV: 'production',
          MUX_SIGNING_KEY_ID: 'key',
          MUX_SIGNING_KEY_PRIVATE: 'private',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).toThrow(/MUX_WEBHOOK_SECRET: required on a deployment/);
  });

  it('requires the internal API key on a deployment', () => {
    expect(() => validateApiEnv(envWithoutBypass({ NODE_ENV: 'production' }))).toThrow(
      /DIAZ_INTERNAL_API_KEY: required on a deployment/,
    );
  });
});

/**
 * The reproduction, as a test. Against the built API this configuration - a
 * deployed database with NODE_ENV never set, which is what `node dist/main.js`,
 * a Dockerfile `CMD` and a Procfile all produce - booted, answered /health with
 * 200, and rejected every Mux delivery, every Stripe delivery and every internal
 * entitlement lookup. Nothing at startup said so.
 */
describe('a deployment started without NODE_ENV', () => {
  const startedWithoutNodeEnv = envWithoutBypass({
    DATABASE_URL: REMOTE_DB,
    MUX_SIGNING_KEY_ID: 'key',
    MUX_SIGNING_KEY_PRIVATE: 'private',
    STRIPE_SECRET_KEY: 'sk_live',
    STRIPE_PRICE_ID_MONTHLY: 'price_monthly',
  });

  it('is refused for each of the three requirements at once', () => {
    let message = '';

    try {
      validateApiEnv(startedWithoutNodeEnv);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/MUX_WEBHOOK_SECRET: required on a deployment/);
    expect(message).toMatch(/STRIPE_WEBHOOK_SECRET: required on a deployment/);
    expect(message).toMatch(/DIAZ_INTERNAL_API_KEY: required on a deployment/);
  });

  it('starts once all three are supplied', () => {
    expect(() =>
      validateApiEnv({
        ...startedWithoutNodeEnv,
        MUX_WEBHOOK_SECRET: 'whsec_mux',
        STRIPE_WEBHOOK_SECRET: 'whsec_stripe',
        DIAZ_INTERNAL_API_KEY: 'internal',
      }),
    ).not.toThrow();
  });
});
