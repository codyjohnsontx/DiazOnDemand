import { auth } from '@clerk/nextjs/server';
import { requestApi } from './api-shared';

export async function apiFetchServer<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await (await auth()).getToken();

  return requestApi<T>(path, {
    ...init,
    token,
  });
}
