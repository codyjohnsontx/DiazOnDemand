'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { clerkEnabled } from '@/lib/config';
import type { ReactNode } from 'react';

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkEnabled) {
    return <>{children}</>;
  }

  return <ClerkProvider>{children}</ClerkProvider>;
}
