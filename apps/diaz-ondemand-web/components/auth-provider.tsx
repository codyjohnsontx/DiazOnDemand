'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { useAuth } from '@clerk/nextjs';
import { clerkEnabled } from '@/lib/config';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

type AuthTokenContextValue = {
  getToken: () => Promise<string | null>;
};

const AuthTokenContext = createContext<AuthTokenContextValue>({
  getToken: async () => null,
});

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
    return (
      <AuthTokenContext.Provider value={{ getToken: async () => null }}>
        {children}
      </AuthTokenContext.Provider>
    );
  }

  return (
    <ClerkProvider>
      <ClerkTokenProvider>{children}</ClerkTokenProvider>
    </ClerkProvider>
  );
}
