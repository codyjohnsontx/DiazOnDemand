'use client';

import { useAuthToken } from '@/components/auth-provider';
import { requestApi } from './api-shared';

export function useApiClient() {
  const { getToken } = useAuthToken();

  return async function apiFetchClient<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getToken();
    return requestApi<T>(path, {
      ...init,
      token,
    });
  };
}
