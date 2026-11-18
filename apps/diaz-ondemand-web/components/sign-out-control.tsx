'use client';

import { SignOutButton } from '@clerk/nextjs';
import { buttonClassName, type ButtonVariant } from '@/components/ui/button';
import { clerkEnabled } from '@/lib/config';

/**
 * Renders nothing when Clerk is not configured, because there is no session to
 * end - the dev bypass authenticates every request from an environment
 * variable.
 */
export function SignOutControl({
  className,
  variant = 'secondary',
}: {
  className?: string;
  variant?: ButtonVariant;
}) {
  if (!clerkEnabled) {
    return null;
  }

  return (
    <SignOutButton redirectUrl="/">
      <button className={buttonClassName({ variant, className })} type="button">
        Sign out
      </button>
    </SignOutButton>
  );
}
