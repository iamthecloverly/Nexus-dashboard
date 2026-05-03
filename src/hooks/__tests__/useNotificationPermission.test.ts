import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationPermission } from '../useNotificationPermission';

class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useNotificationPermission', () => {
  beforeEach(() => {
    MockNotification.permission = 'default';
    MockNotification.requestPermission.mockReset();
    vi.stubGlobal('Notification', MockNotification);
  });

  it('removes the permissions API listener on unmount', async () => {
    const status = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const query = vi.fn().mockResolvedValue(status);
    Object.defineProperty(navigator, 'permissions', {
      value: { query },
      configurable: true,
    });

    const { unmount } = renderHook(() => useNotificationPermission());
    await flushPromises();
    unmount();

    expect(query).toHaveBeenCalledWith({ name: 'notifications' });
    expect(status.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(status.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('updates hook state when permission request throws', async () => {
    MockNotification.requestPermission.mockRejectedValue(new Error('blocked'));

    const { result } = renderHook(() => useNotificationPermission());
    let permission: Awaited<ReturnType<typeof result.current.requestPermission>> | undefined;
    await act(async () => {
      permission = await result.current.requestPermission();
    });

    expect(permission).toBe('denied');
    expect(result.current.permission).toBe('denied');
    expect(result.current.isDenied).toBe(true);
  });
});
