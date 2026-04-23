import { fetchWithTimeout } from './fetchWithTimeout';

export type ApiError = {
  status: number;
  error?: string;
  code?: string;
};

export async function apiFetchJson<T>(
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: true; data: T } | { ok: false; error: ApiError }> {
  const res = await fetchWithTimeout(input, init);
  if (res.ok) {
    const data = (await res.json().catch(() => ({}))) as T;
    return { ok: true as const, data };
  }
  const body = (await res.json().catch(() => ({} as any))) as any;
  return {
    ok: false as const,
    error: {
      status: res.status,
      error: typeof body?.error === 'string' ? body.error : undefined,
      code: typeof body?.code === 'string' ? body.code : undefined,
    },
  };
}

