import type { NextFetchEvent } from 'next/server';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Syntactically valid, made-up Clerk keys: the publishable key decodes to a
// frontend API host that does not exist. Every request here is anonymous, so
// Clerk resolves it as signed-out without any network call.
const FAKE_PUBLISHABLE_KEY = `pk_test_${Buffer.from('fake-frontend.clerk.accounts.dev$').toString('base64')}`;
const FAKE_SECRET_KEY = 'sk_test_fakefakefakefakefakefakefakefakefake';

// middleware.ts and Clerk both read their environment at module load, so each
// case stubs it first and imports a fresh copy.
async function loadMiddleware(comingSoon: 'true' | 'false') {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', FAKE_PUBLISHABLE_KEY);
  vi.stubEnv('CLERK_SECRET_KEY', FAKE_SECRET_KEY);
  vi.stubEnv('NEXT_PUBLIC_CLERK_TELEMETRY_DISABLED', '1');
  vi.stubEnv('NEXT_PUBLIC_DEV_BYPASS_AUTH', 'false');
  vi.stubEnv('VOD_COMING_SOON', comingSoon);
  vi.stubEnv('NEXT_PUBLIC_VOD_COMING_SOON', comingSoon);
  return (await import('../middleware')).default;
}

async function run(comingSoon: 'true' | 'false', path: string) {
  const middleware = await loadMiddleware(comingSoon);
  const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
  return middleware(new NextRequest(`http://localhost:3000${path}`), event);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('coming-soon wall', () => {
  // Response.redirect returned immutable headers, which clerkMiddleware then
  // appends to, so each of these threw "TypeError: immutable" and answered 500.
  it.each(['/account', '/favorites', '/admin', '/library', '/course/abc', '/sign-in'])(
    'redirects %s to the landing page',
    async (path) => {
      const res = await run('true', `${path}?next=1`);

      expect(res?.status).toBe(302);
      expect(res?.headers.get('location')).toBe('http://localhost:3000/');
    },
  );

  it('lets the landing page through', async () => {
    const res = await run('true', '/');

    expect(res?.status).toBe(200);
    expect(res?.headers.get('location')).toBeNull();
  });

  it('does not redirect anything when the wall is off', async () => {
    const res = await run('false', '/library');

    expect(res?.status).toBe(200);
    expect(res?.headers.get('location')).toBeNull();
  });
});
