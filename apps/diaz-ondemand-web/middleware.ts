import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

// /subscribe itself is public: it is the sales page a prospective member
// reaches before they have an account, and it asks them to sign in only when
// they start checkout. The Stripe return pages under it stay protected.
const isProtectedRoute = createRouteMatcher([
  '/account(.*)',
  '/favorites(.*)',
  '/subscribe/(.*)',
  '/admin(.*)',
]);

// Keep these auth flags in sync with lib/config.ts. Middleware runs in the
// Edge runtime, so this file reads process.env directly instead of importing
// the shared app config module.
const devBypassEnabled =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
const clerkConfigured = !devBypassEnabled && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
const comingSoonEnabled =
  process.env.VOD_COMING_SOON === 'true' || process.env.NEXT_PUBLIC_VOD_COMING_SOON === 'true';

export default clerkMiddleware(async (auth, req) => {
  if (comingSoonEnabled && req.nextUrl.pathname !== '/') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    url.search = '';
    // NextResponse, not Response.redirect: clerkMiddleware appends its auth
    // headers to whatever this returns, and Response.redirect's headers are
    // immutable, so every walled path answered 500 (TypeError: immutable).
    return NextResponse.redirect(url, 302);
  }

  if (!clerkConfigured) {
    if (devBypassEnabled || !isProtectedRoute(req)) {
      return;
    }

    return new Response('Clerk misconfigured for protected route', { status: 500 });
  }

  if (isProtectedRoute(req)) {
    await auth.protect();
    return;
  }
}, {
  // Without this, a signed-out page load of a protected route is redirected to
  // Clerk's hosted Account Portal on another domain rather than to the app's
  // own sign-in page. Clerk appends redirect_url so sign-in returns here.
  signInUrl: '/sign-in',
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
