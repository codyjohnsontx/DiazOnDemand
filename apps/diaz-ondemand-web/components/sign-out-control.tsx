'use client';

import { SignOutButton } from '@clerk/nextjs';
import { clerkEnabled } from '@/lib/config';

const BUTTON_CLASSES =
  'inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text)] transition-colors duration-200 hover:bg-white/10';

/**
 * Renders nothing when Clerk is not configured, because there is no session to
 * end - the dev bypass authenticates every request from an environment
 * variable.
 */
export function SignOutControl({ className }: { className?: string }) {
  if (!clerkEnabled) {
    return null;
  }

  return (
    <SignOutButton redirectUrl="/">
      <button className={[BUTTON_CLASSES, className].filter(Boolean).join(' ')} type="button">
        Sign out
      </button>
    </SignOutButton>
  );
}
