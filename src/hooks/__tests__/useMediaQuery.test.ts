import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMediaQuery } from '../useMediaQuery';

describe('useMediaQuery', () => {
  let addListenerSpy: ReturnType<typeof vi.fn>;
  let removeListenerSpy: ReturnType<typeof vi.fn>;
  let mockMql: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    addListenerSpy = vi.fn();
    removeListenerSpy = vi.fn();
    mockMql = {
      matches: false,
      addEventListener: addListenerSpy,
      removeEventListener: removeListenerSpy,
    };
    vi.stubGlobal('window', {
      ...globalThis.window,
      matchMedia: vi.fn().mockReturnValue(mockMql),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false when matchMedia.matches is false', () => {
    mockMql.matches = false;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);
  });

  it('returns true when matchMedia.matches is true', () => {
    mockMql.matches = true;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(true);
  });

  it('registers a change event listener on mount', () => {
    renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(addListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('removes the change event listener on unmount', () => {
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('updates when the media query changes', () => {
    mockMql.matches = false;
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'));
    expect(result.current).toBe(false);

    // Simulate a media query change event by calling the registered handler
    const handler = addListenerSpy.mock.calls[0]?.[1] as () => void;
    mockMql.matches = true;
    act(() => handler());
    expect(result.current).toBe(true);
  });
});
