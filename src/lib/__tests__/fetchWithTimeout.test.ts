import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from '../fetchWithTimeout';

afterEach(() => vi.restoreAllMocks());

describe('fetchWithTimeout', () => {
  it('returns the response on a successful fetch', async () => {
    const mockResponse = new Response('ok', { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const res = await fetchWithTimeout('/api/test');
    expect(res.status).toBe(200);
  });

  it('uses the default 15 s timeout when none is specified', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(new Response('ok'));
    }));

    await fetchWithTimeout('/api/test');
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal!.aborted).toBe(false);
  });

  it('aborts the request and rejects after the timeout fires', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;

    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      // Return a promise that rejects when the signal fires
      return new Promise<Response>((_res, reject) => {
        const sig = init?.signal as AbortSignal | undefined;
        if (sig) {
          sig.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted.', 'AbortError')),
          );
        }
      });
    }));

    const promise = fetchWithTimeout('/api/test', { timeoutMs: 100 });
    vi.advanceTimersByTime(101);

    await expect(promise).rejects.toThrow();
    expect(capturedSignal?.aborted).toBe(true);

    vi.useRealTimers();
  });

  it('does not abort before the timeout fires', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;

    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input, init?: RequestInit) => {
      capturedSignal = init?.signal as AbortSignal | undefined;
      return Promise.resolve(new Response('ok'));
    }));

    await fetchWithTimeout('/api/test', { timeoutMs: 500 });
    expect(capturedSignal?.aborted).toBe(false);

    vi.useRealTimers();
  });

  it('clears the timeout after a successful fetch', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('ok')));

    await fetchWithTimeout('/api/test', { timeoutMs: 5000 });
    expect(clearSpy).toHaveBeenCalled();
  });

  it('clears the timeout even when fetch rejects', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));

    await expect(fetchWithTimeout('/api/test', { timeoutMs: 5000 })).rejects.toThrow('network error');
    expect(clearSpy).toHaveBeenCalled();
  });

  it('forwards extra RequestInit options to fetch', async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_input, init?: RequestInit) => {
      capturedInit = init;
      return Promise.resolve(new Response('ok'));
    }));

    await fetchWithTimeout('/api/test', { method: 'POST', headers: { 'x-test': '1' }, timeoutMs: 5000 });
    expect(capturedInit?.method).toBe('POST');
    expect((capturedInit?.headers as Record<string, string>)['x-test']).toBe('1');
  });
});
