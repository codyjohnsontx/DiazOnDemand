'use client';

import { ClerkProvider, useAuth } from '@clerk/nextjs';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import { clerkEnabled } from '@/lib/config';

type AuthTokenContextValue = {
  getToken: () => Promise<string | null>;
};

const AuthTokenContext = createContext<AuthTokenContextValue>({
  getToken: async () => null,
});
const BYPASS_AUTH_TOKEN_VALUE: AuthTokenContextValue = {
  getToken: async () => null,
};

export function useAuthToken() {
  return useContext(AuthTokenContext);
}

function ClerkTokenProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  return (
    <AuthTokenContext.Provider value={{ getToken }}>
      {children}
    </AuthTokenContext.Provider>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  if (!clerkEnabled) {
    return <AuthTokenContext.Provider value={BYPASS_AUTH_TOKEN_VALUE}>{children}</AuthTokenContext.Provider>;
  }

  return (
    <ClerkProvider>
      <ClerkTokenProvider>{children}</ClerkTokenProvider>
    </ClerkProvider>
  );
}
