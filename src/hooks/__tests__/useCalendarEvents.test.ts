import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiFetchJson } from '../../lib/apiFetch';
import { __testOnly, useCalendarEvents } from '../useCalendarEvents';
import type { CalendarEvent } from '../../types/calendar';
import { STORAGE_KEYS } from '../../constants/storageKeys';

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

function timedEvent(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    summary: id,
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: `https://calendar.test/${id}`,
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

function staleYesterdayEvent(): CalendarEvent {
  return {
    id: 'yesterday',
    summary: 'Yesterday',
    start: { dateTime: '2026-05-02T18:00:00-04:00' },
    end: { dateTime: '2026-05-02T21:30:00-04:00' },
    htmlLink: 'https://calendar.test/yesterday',
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

  it('refetches periodically while the tab is visible', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 21, 0, 0));

    renderHook(() => useCalendarEvents());
    await flushPromises();
    expect(mockedApiFetchJson).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(60_001);
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

  it('drops stale events returned for a previous local day', async () => {
    vi.setSystemTime(new Date('2026-05-03T02:22:00-04:00'));
    mockedApiFetchJson.mockResolvedValue({
      ok: true,
      data: { events: [staleYesterdayEvent()] },
    });

    const { result } = renderHook(() => useCalendarEvents());
    await flushPromises();

    expect(String(mockedApiFetchJson.mock.calls[0][0])).toContain('day=2026-05-03');
    expect(result.current.events).toEqual([]);
  });

  it('clears stale saved calendar filters so readable calendars are not skipped', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0));
    localStorage.setItem(`${STORAGE_KEYS.calendarIncludedIds}_primary`, JSON.stringify(['old-academic-calendar']));
    localStorage.setItem(`${STORAGE_KEYS.calendarMainId}_primary`, 'old-main-calendar');

    const { result } = renderHook(() => useCalendarEvents());
    await flushPromises();

    const requestedUrl = String(mockedApiFetchJson.mock.calls.find(([input]) => String(input).startsWith('/api/calendar/events'))?.[0]);
    expect(requestedUrl).not.toContain('calendarIds=');
    expect(result.current.filtersActive).toBe(false);
    expect(localStorage.getItem(`${STORAGE_KEYS.calendarIncludedIds}_primary`)).toBeNull();
    expect(localStorage.getItem(`${STORAGE_KEYS.calendarMainId}_primary`)).toBeNull();
  });

  it('can ignore saved calendar filters for full-day surfaces like Focus Mode', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0));
    localStorage.setItem(STORAGE_KEYS.calendarSelectionVersion, __testOnly.CALENDAR_SELECTION_VERSION);
    localStorage.setItem(`${STORAGE_KEYS.calendarIncludedIds}_primary`, JSON.stringify(['old-main-calendar']));
    localStorage.setItem(`${STORAGE_KEYS.calendarMainId}_primary`, 'old-main-calendar');

    renderHook(() => useCalendarEvents({ accountMode: 'allConnected', respectSavedFilters: false }));
    await flushPromises();

    const requestedUrl = String(mockedApiFetchJson.mock.calls.find(([input]) => String(input).startsWith('/api/calendar/events'))?.[0]);
    expect(requestedUrl).not.toContain('calendarIds=');
    expect(localStorage.getItem(`${STORAGE_KEYS.calendarIncludedIds}_primary`)).toBe(JSON.stringify(['old-main-calendar']));
    expect(localStorage.getItem(`${STORAGE_KEYS.calendarMainId}_primary`)).toBe('old-main-calendar');
  });

  it('respects current calendar filters when fetching all connected accounts', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0));
    localStorage.setItem(STORAGE_KEYS.calendarSelectionVersion, __testOnly.CALENDAR_SELECTION_VERSION);
    localStorage.setItem(`${STORAGE_KEYS.calendarIncludedIds}_primary`, JSON.stringify(['shift-calendar']));
    mockedApiFetchJson.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/google/accounts') {
        return {
          ok: true,
          data: { accounts: [{ accountId: 'primary', connected: true }] },
        };
      }
      return { ok: true, data: { events: [timedEvent('shift', '2026-05-01T12:00:00', '2026-05-01T15:00:00')] } };
    });

    const { result } = renderHook(() => useCalendarEvents({ accountMode: 'allConnected' }));
    await flushPromises();

    const requestedUrl = String(mockedApiFetchJson.mock.calls.find(([input]) => String(input).startsWith('/api/calendar/events'))?.[0]);
    expect(requestedUrl).toContain('calendarIds=shift-calendar');
    expect(result.current.filtersActive).toBe(true);
    expect(result.current.events.map(event => event.id)).toEqual(['shift']);
  });

  it('merges today events from all connected Google accounts', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0));
    mockedApiFetchJson.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/google/accounts') {
        return {
          ok: true,
          data: {
            accounts: [
              { accountId: 'primary', connected: true },
              { accountId: 'secondary', connected: true },
            ],
          },
        };
      }
      if (url.includes('accountId=secondary')) {
        return {
          ok: true,
          data: { events: [timedEvent('secondary-now', '2026-05-01T11:30:00', '2026-05-01T12:30:00')] },
        };
      }
      return {
        ok: true,
        data: { events: [timedEvent('primary-next', '2026-05-01T13:00:00', '2026-05-01T13:30:00')] },
      };
    });

    const { result } = renderHook(() => useCalendarEvents({ accountMode: 'allConnected' }));
    await flushPromises();

    expect(mockedApiFetchJson).toHaveBeenCalledWith('/api/auth/google/accounts', { timeoutMs: 5_000 });
    expect(result.current.events.map(event => event.id).sort()).toEqual([
      'primary:primary-next',
      'secondary:secondary-now',
    ]);
  });

  it('surfaces a connected account error instead of hiding it behind an empty account', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0));
    mockedApiFetchJson.mockImplementation(async (input) => {
      const url = String(input);
      if (url === '/api/auth/google/accounts') {
        return {
          ok: true,
          data: {
            accounts: [
              { accountId: 'primary', connected: true },
              { accountId: 'secondary', connected: true },
            ],
          },
        };
      }
      if (url.includes('accountId=secondary')) {
        return { ok: false, error: { status: 401, error: 'Token expired or invalid' } };
      }
      return { ok: true, data: { events: [] } };
    });

    const { result } = renderHook(() => useCalendarEvents({ accountMode: 'allConnected' }));
    await flushPromises();

    expect(result.current.events).toEqual([]);
    expect(result.current.isConnected).toBe(false);
    expect(result.current.error).toBe('not_connected');
  });

  it('uses refreshing state instead of blocking loading for visible-tab refreshes', async () => {
    vi.setSystemTime(new Date(2026, 4, 1, 12, 0, 0));
    let resolveRefresh: ((value: Awaited<ReturnType<typeof apiFetchJson<{ events?: CalendarEvent[] }>>>) => void) | null = null;
    mockedApiFetchJson
      .mockResolvedValueOnce({
        ok: true,
        data: { events: [timedEvent('first', '2026-05-01T13:00:00', '2026-05-01T13:30:00')] },
      })
      .mockImplementationOnce(() => new Promise(resolve => { resolveRefresh = resolve; }));

    const { result } = renderHook(() => useCalendarEvents());
    await flushPromises();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(false);

    await act(async () => {
      vi.advanceTimersByTime(60_001);
      await Promise.resolve();
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(true);

    await act(async () => {
      resolveRefresh?.({
        ok: true,
        data: { events: [timedEvent('second', '2026-05-01T14:00:00', '2026-05-01T14:30:00')] },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.events.map(event => event.id)).toEqual(['second']);
  });
});
