import 'react-native-gesture-handler';
import { ClerkProvider } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import type React from 'react';
import { AuthTokenProvider, StaticAuthTokenProvider } from './src/auth-provider';
import { MobileApp } from './src/mobile-app';

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
};

export default function App() {
  const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (!clerkPublishableKey) {
    return (
      <StaticAuthTokenProvider>
        <MobileApp />
      </StaticAuthTokenProvider>
    );
  }

  const Provider = ClerkProvider as unknown as (props: {
    tokenCache: typeof tokenCache;
    publishableKey: string;
    children?: React.ReactNode;
  }) => React.ReactNode;

  return Provider({
    tokenCache,
    publishableKey: clerkPublishableKey,
    children: (
      <AuthTokenProvider>
        <MobileApp />
      </AuthTokenProvider>
    ),
  }) as React.JSX.Element;
}
