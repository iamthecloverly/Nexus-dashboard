import { describe, it, expect, vi, afterEach } from 'vitest';
import { apiFetchJson, type ApiError } from '../apiFetch';

afterEach(() => vi.restoreAllMocks());

describe('apiFetchJson', () => {
  it('returns { ok: true, data } for a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 42 }), { status: 200 }),
    ));

    const result = await apiFetchJson<{ value: number }>('/api/test');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.value).toBe(42);
  });

  it('returns { ok: false, error } for a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }), { status: 404 }),
    ));

    const result = await apiFetchJson('/api/missing');
    expect(result.ok).toBe(false);
    const { error } = result as { ok: false; error: ApiError };
    expect(error.status).toBe(404);
    expect(error.error).toBe('Not found');
    expect(error.code).toBe('NOT_FOUND');
  });

  it('returns { ok: false } with status but no error/code when body is empty', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('', { status: 500 }),
    ));

    const result = await apiFetchJson('/api/server-error');
    expect(result.ok).toBe(false);
    const { error } = result as { ok: false; error: ApiError };
    expect(error.status).toBe(500);
    expect(error.error).toBeUndefined();
    expect(error.code).toBeUndefined();
  });

  it('returns { ok: true, data: {} } when response body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('not-json', { status: 200 }),
    ));

    const result = await apiFetchJson('/api/bad-json');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({});
  });

  it('propagates fetch rejection (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network fail')));

    await expect(apiFetchJson('/api/down')).rejects.toThrow('network fail');
  });

  it('handles 401 response with error field only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    ));

    const result = await apiFetchJson('/api/protected');
    expect(result.ok).toBe(false);
    const { error } = result as { ok: false; error: ApiError };
    expect(error.status).toBe(401);
    expect(error.error).toBe('Unauthorized');
    expect(error.code).toBeUndefined();
  });

  it('ignores non-string error/code fields in error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 123, code: true }), { status: 400 }),
    ));

    const result = await apiFetchJson('/api/bad');
    expect(result.ok).toBe(false);
    const { error } = result as { ok: false; error: ApiError };
    expect(error.error).toBeUndefined();
    expect(error.code).toBeUndefined();
  });
});
