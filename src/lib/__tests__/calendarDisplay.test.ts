import { describe, expect, it } from 'vitest';

import {
  formatCalendarEventTime,
  getCalendarEventDisplayState,
  splitCalendarEvents,
} from '../calendarDisplay';
import type { CalendarEvent } from '../../types/calendar';

const now = new Date('2026-05-01T15:00:00');

function timedEvent(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    summary: id,
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: `https://calendar.test/${id}`,
  };
}

function allDayEvent(id: string, date: string): CalendarEvent {
  return {
    id,
    summary: id,
    start: { date },
    end: { date: '2026-05-02' },
    htmlLink: `https://calendar.test/${id}`,
  };
}

describe('calendar display helpers', () => {
  it('puts a past timed event in earlier', () => {
    const past = timedEvent('past', '2026-05-01T13:00:00', '2026-05-01T14:00:00');

    expect(getCalendarEventDisplayState(past, now)).toBe('past');
    expect(splitCalendarEvents([past], now).earlier.map(item => item.event.id)).toEqual(['past']);
  });

  it('puts a current timed event in current', () => {
    const current = timedEvent('current', '2026-05-01T14:30:00', '2026-05-01T15:30:00');

    expect(getCalendarEventDisplayState(current, now)).toBe('current');
    expect(splitCalendarEvents([current], now).current.map(item => item.event.id)).toEqual(['current']);
  });

  it('puts a future timed event in upcoming', () => {
    const future = timedEvent('future', '2026-05-01T16:00:00', '2026-05-01T16:30:00');

    expect(getCalendarEventDisplayState(future, now)).toBe('upcoming');
    expect(splitCalendarEvents([future], now).upcoming.map(item => item.event.id)).toEqual(['future']);
  });

  it('keeps all-day events visible for today', () => {
    const allDay = allDayEvent('all-day', '2026-05-01');
    const split = splitCalendarEvents([allDay], now);

    expect(getCalendarEventDisplayState(allDay, now)).toBe('allDay');
    expect(split.allDay.map(item => item.event.id)).toEqual(['all-day']);
    expect(split.hasRemainingToday).toBe(true);
  });

  it('excludes invalid or incomplete timed events safely', () => {
    const invalidDate = timedEvent('invalid-date', 'not-a-date', '2026-05-01T16:00:00');
    const missingEnd: CalendarEvent = {
      id: 'missing-end',
      summary: 'missing-end',
      start: { dateTime: '2026-05-01T16:00:00' },
      end: {},
      htmlLink: 'https://calendar.test/missing-end',
    };
    const backwards = timedEvent('backwards', '2026-05-01T16:00:00', '2026-05-01T15:00:00');
    const split = splitCalendarEvents([invalidDate, missingEnd, backwards], now);

    expect(split.displayable).toEqual([]);
    expect(split.invalidCount).toBe(3);
  });

  it('marks only-past today as eligible for upcoming fallback', () => {
    const past = timedEvent('past', '2026-05-01T13:00:00', '2026-05-01T14:00:00');
    const split = splitCalendarEvents([past], now);

    expect(split.earlier).toHaveLength(1);
    expect(split.hasRemainingToday).toBe(false);
  });

  it('formats today and upcoming labels consistently', () => {
    const event = timedEvent('standup', '2026-05-01T16:00:00', '2026-05-01T16:30:00');
    const item = splitCalendarEvents([event], now).upcoming[0];

    expect(formatCalendarEventTime(item, 'today')).toBe('16:00 – 16:30');
    expect(formatCalendarEventTime(item, 'upcoming')).toBe('May 1 · 16:00 – 16:30');
  });
});
