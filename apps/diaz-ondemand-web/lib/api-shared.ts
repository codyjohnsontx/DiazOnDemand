import { apiBaseUrl, devUserId } from './config';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(message);
  }
}

type ApiRequestOptions = RequestInit & {
  token?: string | null;
};

export async function requestApi<T>(path: string, init?: ApiRequestOptions): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');

  if (init?.token) {
    headers.set('Authorization', `Bearer ${init.token}`);
  } else if (devUserId) {
    headers.set('x-dev-user-id', devUserId);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers,
    cache: init?.cache ?? 'no-store',
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new ApiError(`${response.status} ${detail}`, response.status, detail);
  }

  return response.json() as Promise<T>;
}
