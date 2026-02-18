'use client';

import { SignIn } from '@clerk/nextjs';
import { clerkEnabled } from '@/lib/config';

export default function SignInPage() {
  if (!clerkEnabled) {
    return (
      <div className="rounded border bg-white p-6">
        <h1 className="text-lg font-semibold">Sign In</h1>
        <p className="mt-2 text-sm text-gray-600">
          Clerk keys are not configured. Use `DEV_BYPASS_AUTH=true` in API with `NEXT_PUBLIC_DEV_USER_ID`.
        </p>
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <SignIn fallbackRedirectUrl="/library" />
    </div>
  );
}
