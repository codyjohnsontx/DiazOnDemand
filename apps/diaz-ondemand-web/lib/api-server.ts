import { auth } from '@clerk/nextjs/server';
import { clerkEnabled } from './config';
import { requestApi } from './api-shared';

export async function apiFetchServer<T>(path: string, init?: RequestInit): Promise<T> {
  const token =
    clerkEnabled
      ? await (await auth()).getToken()
      : null;

  return requestApi<T>(path, {
    ...init,
    token,
  });
}
