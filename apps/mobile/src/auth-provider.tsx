import { useAuth, useClerk } from '@clerk/clerk-expo';
import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';

type AuthTokenContextValue = {
  getToken: () => Promise<string | null>;
  isDevelopmentBypass: boolean;
  signOut: () => Promise<void>;
};

const AuthTokenContext = createContext<AuthTokenContextValue>({
  getToken: async () => null,
  isDevelopmentBypass: false,
  signOut: async () => undefined,
});

export function useAuthToken() {
  return useContext(AuthTokenContext);
}

export function AuthTokenProvider({ children }: { children: ReactNode }) {
  const { getToken } = useAuth();
  const { signOut } = useClerk();

  return (
    <AuthTokenContext.Provider value={{ getToken, isDevelopmentBypass: false, signOut }}>
      {children}
    </AuthTokenContext.Provider>
  );
}

export function StaticAuthTokenProvider({ children }: { children: ReactNode }) {
  return (
    <AuthTokenContext.Provider
      value={{
        getToken: async () => null,
        isDevelopmentBypass: true,
        signOut: async () => undefined,
      }}
    >
      {children}
    </AuthTokenContext.Provider>
  );
}
