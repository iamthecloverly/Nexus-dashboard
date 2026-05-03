import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTaskNotifications } from '../useTaskNotifications';
import type { Task } from '../../types/task';

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static calls: Array<{ title: string; options?: NotificationOptions }> = [];

  constructor(title: string, options?: NotificationOptions) {
    MockNotification.calls.push({ title, options });
  }

  close = vi.fn();
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Local-day task',
    completed: false,
    group: 'now',
    ...overrides,
  };
}

describe('useTaskNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockNotification.calls = [];
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches due dates against the local day instead of UTC', () => {
    vi.setSystemTime(new Date(2026, 4, 3, 23, 30, 0));

    renderHook(() => useTaskNotifications([task({ dueDate: '2026-05-03' })], true));

    expect(MockNotification.calls).toHaveLength(1);
    expect(MockNotification.calls[0]?.options?.body).toBe('Local-day task');
  });

  it('does not notify completed tasks', () => {
    vi.setSystemTime(new Date(2026, 4, 3, 10, 0, 0));

    renderHook(() => useTaskNotifications([task({ dueDate: '2026-05-03', completed: true })], true));

    expect(MockNotification.calls).toHaveLength(0);
  });
});
