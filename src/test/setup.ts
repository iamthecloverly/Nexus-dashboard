import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';

// Extend Vitest's expect with jest-dom matchers
expect.extend(matchers);

function installStorageShim(name: 'localStorage' | 'sessionStorage') {
  const existing = globalThis[name];
  if (
    existing &&
    typeof existing.getItem === 'function' &&
    typeof existing.setItem === 'function' &&
    typeof existing.removeItem === 'function' &&
    typeof existing.clear === 'function'
  ) {
    return;
  }

  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(String(key)) ? store.get(String(key)) ?? null : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(String(key));
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, {
      value: storage,
      configurable: true,
    });
  }
}

installStorageShim('localStorage');
installStorageShim('sessionStorage');

// Cleanup after each test
afterEach(() => {
  cleanup();
  // Prevent cross-test contamination from vi.stubGlobal (e.g. fetch).
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
