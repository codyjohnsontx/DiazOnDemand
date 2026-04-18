export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
const rawDevUserId = process.env.NEXT_PUBLIC_DEV_USER_ID?.trim();
export const devBypassEnabled =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true';
export const clerkEnabled = !devBypassEnabled && Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
export const devUserId = devBypassEnabled ? rawDevUserId || 'dev_clerk_user' : null;
export const marketingSiteUrl =
  process.env.NEXT_PUBLIC_MARKETING_SITE_URL ?? 'https://www.diazmartialarts.com';
