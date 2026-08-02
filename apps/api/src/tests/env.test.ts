import { describe, expect, it } from 'vitest';
import {
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

describe('Mux signing key startup refusal', () => {
  it('refuses a deployed database without signing keys, NODE_ENV unset', () => {
    expect(() => validateApiEnv(envWithoutBypass({ DATABASE_URL: REMOTE_DB }))).toThrow(
      /MUX_SIGNING_KEY_ID: required on a deployment together with MUX_SIGNING_KEY_PRIVATE/,
    );
  });

  // The refusal is keyed on the deployment, never on an "is Mux enabled" proxy:
  // nothing in the runtime reads MUX_TOKEN_ID, so a deployment can serve Mux
  // video without it and would otherwise slip past this check.
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
        }),
      ),
    ).not.toThrow();
  });

  it('still lets a developer run Mux against a local database without signing keys', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({ MUX_TOKEN_ID: 'token', MUX_TOKEN_SECRET: 'secret' }),
      ),
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

  it('requires a Stripe webhook secret in production', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          NODE_ENV: 'production',
          STRIPE_SECRET_KEY: 'sk_live',
          STRIPE_PRICE_ID_MONTHLY: 'price_monthly',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).toThrow(/STRIPE_WEBHOOK_SECRET: required in production/);
  });

  it('requires Mux credentials and signing keys to be paired', () => {
    expect(() => validateApiEnv(envWithoutBypass({ MUX_TOKEN_ID: 'token' }))).toThrow(
      /MUX_TOKEN_ID and MUX_TOKEN_SECRET must be provided together/,
    );
    expect(() => validateApiEnv(envWithoutBypass({ MUX_SIGNING_KEY_ID: 'key' }))).toThrow(
      /MUX_SIGNING_KEY_ID and MUX_SIGNING_KEY_PRIVATE must be provided together/,
    );
  });

  it('requires Mux webhook and signing configuration in production', () => {
    expect(() =>
      validateApiEnv(
        envWithoutBypass({
          NODE_ENV: 'production',
          MUX_TOKEN_ID: 'token',
          MUX_TOKEN_SECRET: 'secret',
          DIAZ_INTERNAL_API_KEY: 'internal',
        }),
      ),
    ).toThrow(/MUX_WEBHOOK_SECRET: required in production/);

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

  it('requires the internal API key in production', () => {
    expect(() => validateApiEnv(envWithoutBypass({ NODE_ENV: 'production' }))).toThrow(
      /DIAZ_INTERNAL_API_KEY: required in production/,
    );
  });
});
