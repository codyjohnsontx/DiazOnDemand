import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

const isProtectedRoute = createRouteMatcher([
  '/account(.*)',
  '/favorites(.*)',
  '/subscribe(.*)',
  '/admin(.*)',
]);

// Keep these auth flags in sync with lib/config.ts. Middleware runs in the
// Edge runtime, so this file reads process.env directly instead of importing
// the shared app config module.
const devBypassEnabled =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
const clerkConfigured = !devBypassEnabled && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export default clerkMiddleware(async (auth, req) => {
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
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
