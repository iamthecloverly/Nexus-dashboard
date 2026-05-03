import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCalendarNotifications } from '../useCalendarNotifications';
import type { CalendarEvent } from '../../types/calendar';

const notificationSpy = vi.fn();

class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn();

  close = vi.fn();

  constructor(title: string, options?: NotificationOptions) {
    notificationSpy(title, options);
  }
}

function event(start: string): CalendarEvent {
  return {
    id: 'rescheduled',
    summary: 'Rescheduled',
    start: { dateTime: start },
    end: { dateTime: '2026-05-01T11:00:00' },
    htmlLink: 'https://calendar.test/rescheduled',
  };
}

describe('useCalendarNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-01T09:55:00'));
    notificationSpy.mockClear();
    MockNotification.requestPermission.mockClear();
    vi.stubGlobal('Notification', MockNotification);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('allows a rescheduled event with the same id to notify at the new start time', () => {
    const { rerender } = renderHook(
      ({ events }) => useCalendarNotifications(events, true),
      { initialProps: { events: [event('2026-05-01T10:00:00')] } },
    );

    vi.runOnlyPendingTimers();
    expect(notificationSpy).toHaveBeenCalledTimes(1);

    rerender({ events: [event('2026-05-01T10:10:00')] });
    vi.advanceTimersByTime(10 * 60 * 1000);

    expect(notificationSpy).toHaveBeenCalledTimes(2);
  });
});
