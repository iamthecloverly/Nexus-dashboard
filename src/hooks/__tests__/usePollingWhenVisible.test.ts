import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePollingWhenVisible } from '../usePollingWhenVisible';

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Reset hidden to default
  Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
});

describe('usePollingWhenVisible', () => {
  it('calls poll immediately on mount when enabled and runOnMount=true (default)', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 1000 }));
    // Flush the microtask queue so the Promise.resolve().then(() => poll()) chain runs
    await act(async () => { await Promise.resolve(); });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('does not call poll on mount when runOnMount=false', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 1000, runOnMount: false }));
    await act(async () => { await Promise.resolve(); });
    expect(poll).not.toHaveBeenCalled();
  });

  it('does not call poll when enabled=false', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: false, poll, intervalMs: 1000 }));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('polls repeatedly at the given interval', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 500 }));

    // initial run
    await act(async () => { await Promise.resolve(); });
    expect(poll).toHaveBeenCalledTimes(1);

    // first interval tick
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(2);

    // second interval tick
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('clears the interval on unmount', async () => {
    const poll = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 500 }));
    await act(async () => { await Promise.resolve(); });
    unmount();
    poll.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('does not poll when document is hidden', async () => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 500 }));
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('polls when document becomes visible again (visibilitychange)', async () => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 5000 }));
    // No poll yet (hidden)
    await act(async () => { await Promise.resolve(); });
    expect(poll).not.toHaveBeenCalled();

    // Simulate tab becoming visible
    await act(async () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it('does not trigger visibilitychange poll when runOnVisible=false', async () => {
    Object.defineProperty(document, 'hidden', { value: true, writable: true, configurable: true });
    const poll = vi.fn().mockResolvedValue(undefined);
    renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 5000, runOnVisible: false }));

    await act(async () => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('removes visibilitychange listener on unmount', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const poll = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePollingWhenVisible({ enabled: true, poll, intervalMs: 1000 }));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
