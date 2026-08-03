import 'react-native-gesture-handler';
import { ClerkProvider, useAuth } from '@clerk/clerk-expo';
import * as SecureStore from 'expo-secure-store';
import type React from 'react';
import { ActivityIndicator, SafeAreaView, Text } from 'react-native';
import { AuthTokenProvider, StaticAuthTokenProvider } from './src/auth-provider';
import { MobileApp } from './src/mobile-app';
import { SignInScreen } from './src/sign-in-screen';

const tokenCache = {
  async getToken(key: string) {
    return SecureStore.getItemAsync(key);
  },
  async saveToken(key: string, value: string) {
    return SecureStore.setItemAsync(key, value);
  },
};

export default function App() {
  const isNonProduction = process.env.NODE_ENV !== 'production';
  const devBypassEnabled = isNonProduction && process.env.EXPO_PUBLIC_DEV_BYPASS_AUTH === 'true';
  const clerkPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

  if (devBypassEnabled) {
    return (
      <StaticAuthTokenProvider>
        <MobileApp />
      </StaticAuthTokenProvider>
    );
  }

  if (!clerkPublishableKey) {
    return <MissingClerkConfigScreen />;
  }

  const Provider = ClerkProvider as unknown as (props: {
    tokenCache: typeof tokenCache;
    publishableKey: string;
    children?: React.ReactNode;
  }) => React.ReactNode;

  return Provider({
    tokenCache,
    publishableKey: clerkPublishableKey,
    children: <ClerkAppGate />,
  }) as React.JSX.Element;
}

function ClerkAppGate() {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return <LoadingScreen />;
  }

  if (!isSignedIn) {
    return <SignInScreen />;
  }

  return (
    <AuthTokenProvider>
      <MobileApp />
    </AuthTokenProvider>
  );
}

function LoadingScreen() {
  return (
    <SafeAreaView
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#08090b',
      }}
    >
      <ActivityIndicator color="#c44a2d" />
    </SafeAreaView>
  );
}

function MissingClerkConfigScreen() {
  return (
    <SafeAreaView
      style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#08090b' }}
    >
      <Text style={{ color: '#f3f0e8', fontSize: 20, fontWeight: '700', marginBottom: 8 }}>
        Authentication is not configured
      </Text>
      <Text style={{ color: '#9aa3af', lineHeight: 22 }}>
        Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY or explicitly enable EXPO_PUBLIC_DEV_BYPASS_AUTH for
        local development.
      </Text>
    </SafeAreaView>
  );
}
