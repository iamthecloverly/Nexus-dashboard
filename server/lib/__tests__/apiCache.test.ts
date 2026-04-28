import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cacheGet, cacheBust, tokenKey, __testOnly } from '../apiCache';

describe('apiCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── original sweep test ──────────────────────────────────────────────────

  it('sweepExpired removes expired entries', async () => {
    await cacheGet('k1', 10, async () => 'v1');
    await cacheGet('k2', 10, async () => 'v2');
    expect(__testOnly.storeSize()).toBeGreaterThanOrEqual(2);

    vi.advanceTimersByTime(11);
    __testOnly.sweepExpired();
    expect(__testOnly.storeSize()).toBe(0);
  });

  // ── cacheGet — cache miss / hit ──────────────────────────────────────────

  it('calls the fetcher on a cache miss', async () => {
    const fetcher = vi.fn().mockResolvedValue('miss-value');
    const result = await cacheGet('test-miss', 5000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toBe('miss-value');
  });

  it('returns cached value without re-fetching while still fresh', async () => {
    const fetcher = vi.fn().mockResolvedValue('hit-value');
    await cacheGet('test-hit', 5000, fetcher);
    const second = await cacheGet('test-hit', 5000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(second).toBe('hit-value');
  });

  it('re-fetches after the TTL has expired', async () => {
    const fetcher = vi.fn().mockResolvedValue('v');
    await cacheGet('test-ttl', 100, fetcher);
    vi.advanceTimersByTime(101);
    await cacheGet('test-ttl', 100, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // ── inflight coalescing ──────────────────────────────────────────────────

  it('shares one upstream call for concurrent requests to the same key', async () => {
    let resolve!: (v: string) => void;
    const upstream = new Promise<string>(r => { resolve = r; });
    const fetcher = vi.fn().mockReturnValue(upstream);

    const p1 = cacheGet('test-inflight', 5000, fetcher);
    const p2 = cacheGet('test-inflight', 5000, fetcher);
    resolve('shared');

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r1).toBe('shared');
    expect(r2).toBe('shared');
  });

  it('does not cache errors — next caller retries upstream', async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('recovered');

    await expect(cacheGet('test-error', 5000, fetcher)).rejects.toThrow('fail');
    const result = await cacheGet('test-error', 5000, fetcher);
    expect(result).toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  // ── cacheBust ────────────────────────────────────────────────────────────

  it('cacheBust forces a fresh fetch on the next call', async () => {
    const fetcher = vi.fn().mockResolvedValue('v1');
    await cacheGet('test-bust', 60_000, fetcher);
    cacheBust('test-bust');

    fetcher.mockResolvedValue('v2');
    const result = await cacheGet('test-bust', 60_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result).toBe('v2');
  });

  it('cacheBust is a no-op for an unknown key', () => {
    expect(() => cacheBust('nonexistent-key')).not.toThrow();
  });

  // ── tokenKey ─────────────────────────────────────────────────────────────

  it('tokenKey produces different keys for different tokens', () => {
    const k1 = tokenKey('token-a', 'suffix');
    const k2 = tokenKey('token-b', 'suffix');
    expect(k1).not.toBe(k2);
  });

  it('tokenKey is stable for the same inputs', () => {
    expect(tokenKey('tok', 'events')).toBe(tokenKey('tok', 'events'));
  });

  it('tokenKey embeds the suffix in the key', () => {
    expect(tokenKey('tok', 'notifications')).toContain('notifications');
  });

  it('tokenKey produces different keys for same token with different suffixes', () => {
    expect(tokenKey('tok', 'events')).not.toBe(tokenKey('tok', 'messages'));
  });
});

