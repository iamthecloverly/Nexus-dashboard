/**
 * Lightweight in-memory TTL cache with request coalescing.
 *
 * - Cache key is caller-supplied (usually a hash of auth token + route).
 * - Inflight coalescing: concurrent requests for the same key share one
 *   upstream fetch instead of fanning out N identical API calls.
 * - Errors are never cached; the next caller always retries.
 */

import { createHash } from 'node:crypto';

interface Entry<T> {
  data: T;
  expiresAt: number;
}

// Separate map for in-flight promises so we never store a rejected promise as data.
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

/** Return cached data if still fresh, otherwise null. */
function getHit<T>(key: string): T | null {
  const entry = store.get(key) as Entry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { store.delete(key); return null; }
  return entry.data;
}

function sweepExpired(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of store.entries()) {
    if (now > entry.expiresAt) {
      store.delete(key);
      removed++;
    }
  }
  return removed;
}

// Periodic cleanup so the cache can't grow unbounded under key churn.
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => { sweepExpired(); }, SWEEP_INTERVAL_MS).unref?.();

/** Store data under key for ttlMs milliseconds. */
function put<T>(key: string, data: T, ttlMs: number): void {
  const expiresAt = Date.now() + ttlMs;
  store.set(key, { data, expiresAt });
}

/**
 * Return cached value if fresh; otherwise call `fetcher()` exactly once
 * (concurrent callers share the same Promise) and cache the result.
 */
export async function cacheGet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = getHit<T>(key);
  if (hit !== null) return hit;

  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = fetcher().then(data => {
    put(key, data, ttlMs);
    inflight.delete(key);
    return data;
  }).catch(err => {
    // Errors are intentionally not cached: the next caller should retry
    // rather than receiving a stale error. The inflight entry is removed
    // so concurrent waiters also get a fresh attempt.
    inflight.delete(key);
    throw err;
  });

  inflight.set(key, promise as Promise<unknown>);
  return promise;
}

/** Remove a cache entry (call after mutations so the next read is fresh). */
export function cacheBust(key: string): void {
  store.delete(key);
  // Don't cancel the inflight – it will just miss the cache on resolve.
}

/**
 * Derive a stable, short cache key from an arbitrary string (token, cookie value).
 * Uses SHA-256 truncated to 16 hex chars – not for security, just identity.
 */
export function tokenKey(token: string, suffix: string): string {
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 16);
  return `${hash}:${suffix}`;
}

export const __testOnly = {
  sweepExpired,
  storeSize: () => store.size,
};
