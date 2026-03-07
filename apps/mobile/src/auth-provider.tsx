import { useAuth } from '@clerk/clerk-expo';
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

export function AuthTokenProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();

  return (
    <AuthTokenContext.Provider value={{ getToken }}>
      {children}
    </AuthTokenContext.Provider>
  );
}

export function StaticAuthTokenProvider({ children }: { children: ReactNode }) {
  return (
    <AuthTokenContext.Provider value={{ getToken: async () => null }}>
      {children}
    </AuthTokenContext.Provider>
  );
}
