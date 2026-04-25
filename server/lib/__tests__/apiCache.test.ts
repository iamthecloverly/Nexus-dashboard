import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __testOnly } from '../apiCache';

describe('apiCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sweepExpired removes expired entries', async () => {
    // Use cacheGet to populate the cache with short TTL entries
    const { cacheGet } = await import('../apiCache');

    await cacheGet('k1', 10, async () => 'v1');
    await cacheGet('k2', 10, async () => 'v2');
    expect(__testOnly.storeSize()).toBeGreaterThanOrEqual(2);

    vi.advanceTimersByTime(11);
    __testOnly.sweepExpired();
    expect(__testOnly.storeSize()).toBe(0);
  });
});

