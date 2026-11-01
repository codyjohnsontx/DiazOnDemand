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

async function run(comingSoon: 'true' | 'false', path: string, headers?: HeadersInit) {
  const middleware = await loadMiddleware(comingSoon);
  const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
  return middleware(new NextRequest(`http://localhost:3000${path}`, { headers }), event);
}

// A signed-out browser that has already been through Clerk's dev-browser
// handshake: any __clerk_db_jwt and a zero __client_uat. Without them a
// development key answers every page load with the handshake redirect.
const SIGNED_OUT_COOKIES = '__clerk_db_jwt=dvb_fake; __client_uat=0';
// Clerk only redirects a signed-out caller to sign in when the request looks
// like a page load; anything else is answered as not found.
const PAGE_REQUEST = { accept: 'text/html,application/xhtml+xml', cookie: SIGNED_OUT_COOKIES };

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

describe('signed-out visitors', () => {
  // Without a signInUrl, protect() sent page loads to Clerk's hosted Account
  // Portal on another domain instead of the app's own /sign-in page.
  it.each(['/account', '/favorites', '/admin', '/subscribe/success', '/subscribe/cancel'])(
    'sends a page load of %s to the in-app sign-in page with a return path',
    async (path) => {
      const res = await run('false', `${path}?tab=1`, PAGE_REQUEST);

      expect(res?.status).toBe(307);
      const location = new URL(res?.headers.get('location') ?? '');
      expect(location.origin + location.pathname).toBe('http://localhost:3000/sign-in');
      expect(location.searchParams.get('redirect_url')).toBe(`http://localhost:3000${path}?tab=1`);
    },
  );

  it('answers 404 rather than an HTML redirect to a non-page request', async () => {
    const res = await run('false', '/account', { accept: 'application/json', cookie: SIGNED_OUT_COOKIES });

    expect(res?.headers.get('location')).toBeNull();
    // Clerk throws Next's notFound(), which middleware turns into a rewrite
    // to a path that renders the 404 page.
    expect(res?.headers.get('x-middleware-rewrite')).toMatch(/\/clerk_\d+$/);
  });

  // The sales page is where a prospective member arrives before they have an
  // account; checkout itself still needs one, and the page asks for it then.
  it.each(['/subscribe', '/library', '/sign-in'])('lets %s through', async (path) => {
    const res = await run('false', path, PAGE_REQUEST);

    expect(res?.status).toBe(200);
    expect(res?.headers.get('location')).toBeNull();
  });
});
