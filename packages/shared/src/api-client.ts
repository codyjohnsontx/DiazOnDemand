import { z } from 'zod';

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getHeaders?: () => Record<string, string>,
  ) {}

  async get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    return this.request(path, { method: 'GET' }, schema);
  }

  async post<T, B = unknown>(path: string, body: B, schema: z.ZodType<T>): Promise<T> {
    return this.request(
      path,
      {
        method: 'POST',
        body: JSON.stringify(body),
      },
      schema,
    );
  }

  async patch<T, B = unknown>(path: string, body: B, schema: z.ZodType<T>): Promise<T> {
    return this.request(
      path,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      },
      schema,
    );
  }

  async delete(path: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(this.getHeaders?.() ?? {}),
      },
    });

    if (!response.ok) {
      throw new Error(`DELETE ${path} failed (${response.status})`);
    }
  }

  private async request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(this.getHeaders?.() ?? {}),
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${init.method ?? 'GET'} ${path} failed (${response.status}): ${text}`);
    }

    const json = await response.json();
    return schema.parse(json);
  }
}
