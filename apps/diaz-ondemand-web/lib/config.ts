export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const devUserId = process.env.NEXT_PUBLIC_DEV_USER_ID ?? 'dev_clerk_user';
export const clerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
