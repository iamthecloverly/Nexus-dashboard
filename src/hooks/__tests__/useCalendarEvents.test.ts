import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetchJson } from '../../lib/apiFetch';
import { useCalendarEvents } from '../useCalendarEvents';
import type { CalendarEvent } from '../../types/calendar';

vi.mock('../../lib/apiFetch', () => ({
  apiFetchJson: vi.fn(),
}));

const mockedApiFetchJson = vi.mocked(apiFetchJson);

function futureEvent(start: string, end: string): CalendarEvent {
  return {
    id: 'future',
    summary: 'Future',
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: 'https://calendar.test/future',
  };
}

function pastEvent(): CalendarEvent {
  return {
    id: 'past',
    summary: 'Past',
    start: { dateTime: '2026-05-01T08:00:00' },
    end: { dateTime: '2026-05-01T09:00:00' },
    htmlLink: 'https://calendar.test/past',
  };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useCalendarEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedApiFetchJson.mockReset();
    mockedApiFetchJson.mockResolvedValue({
      ok: true,
      data: {
        events: [futureEvent('2026-05-01T23:59:55', '2026-05-02T00:10:00')],
      },
    });
    localStorage.clear();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refetches after the local day rolls over', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 23, 59, 50));

    renderHook(() => useCalendarEvents());
    await flushPromises();
    expect(mockedApiFetchJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(15_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedApiFetchJson).toHaveBeenCalledTimes(2);
  });

  it('refetches when the tab becomes visible on a stale local day', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 10, 0, 0));
    mockedApiFetchJson.mockResolvedValue({
      ok: true,
      data: {
        events: [futureEvent('2026-05-02T11:00:00', '2026-05-02T11:30:00')],
      },
    });

    renderHook(() => useCalendarEvents());
    await flushPromises();
    expect(mockedApiFetchJson).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date(2026, 4, 2, 10, 0, 0));
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedApiFetchJson).toHaveBeenCalledTimes(2);
  });

  it('keeps the schedule scoped to today even when today only has past events', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 17, 0, 0));
    mockedApiFetchJson.mockResolvedValue({
      ok: true,
      data: { events: [pastEvent()] },
    });

    const { result } = renderHook(() => useCalendarEvents());
    await flushPromises();

    expect(mockedApiFetchJson).toHaveBeenCalledTimes(1);
    expect(result.current.mode).toBe('today');
    expect(result.current.events.map(event => event.id)).toEqual(['past']);
  });
});
