import { format, isValid, parseISO } from 'date-fns';

import type { CalendarEvent } from '../types/calendar';

export type CalendarDisplayState = 'past' | 'current' | 'upcoming' | 'allDay';
export type CalendarDisplayMode = 'today' | 'upcoming';

export interface CalendarDisplayItem {
  event: CalendarEvent;
  state: CalendarDisplayState;
  start: Date;
  end: Date | null;
  sortMs: number;
  dateKey: string;
  title: string;
}

export interface SplitCalendarEvents {
  allDay: CalendarDisplayItem[];
  current: CalendarDisplayItem[];
  upcoming: CalendarDisplayItem[];
  earlier: CalendarDisplayItem[];
  displayable: CalendarDisplayItem[];
  primary: CalendarDisplayItem[];
  hasRemainingToday: boolean;
  invalidCount: number;
}

function parseCalendarDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function isAllDayEvent(event: CalendarEvent): boolean {
  return !!event.start?.date && !event.start?.dateTime;
}

function getEventTitle(event: CalendarEvent): string {
  return event.summary?.trim() || 'Busy';
}

export function getCalendarEventDateKey(event: CalendarEvent): string | null {
  if (event.start?.date) return event.start.date;
  const start = parseCalendarDate(event.start?.dateTime);
  return start ? format(start, 'yyyy-MM-dd') : null;
}

export function getCalendarEventDisplayItem(event: CalendarEvent, now: Date): CalendarDisplayItem | null {
  if (!isValid(now)) return null;

  if (isAllDayEvent(event)) {
    const start = parseCalendarDate(event.start.date);
    if (!start) return null;
    return {
      event,
      state: 'allDay',
      start,
      end: parseCalendarDate(event.end?.date),
      sortMs: start.getTime(),
      dateKey: event.start.date,
      title: getEventTitle(event),
    };
  }

  const start = parseCalendarDate(event.start?.dateTime);
  const end = parseCalendarDate(event.end?.dateTime);
  if (!start || !end || end.getTime() <= start.getTime()) return null;

  const nowMs = now.getTime();
  const startMs = start.getTime();
  const endMs = end.getTime();
  const state: CalendarDisplayState =
    endMs <= nowMs ? 'past' : startMs <= nowMs ? 'current' : 'upcoming';

  return {
    event,
    state,
    start,
    end,
    sortMs: startMs,
    dateKey: format(start, 'yyyy-MM-dd'),
    title: getEventTitle(event),
  };
}

export function getCalendarEventDisplayState(event: CalendarEvent, now: Date): CalendarDisplayState | null {
  return getCalendarEventDisplayItem(event, now)?.state ?? null;
}

function byScheduleOrder(a: CalendarDisplayItem, b: CalendarDisplayItem): number {
  return a.sortMs - b.sortMs || a.title.localeCompare(b.title) || a.event.id.localeCompare(b.event.id);
}

export function splitCalendarEvents(events: CalendarEvent[], now: Date): SplitCalendarEvents {
  const displayable: CalendarDisplayItem[] = [];
  let invalidCount = 0;

  for (const event of events) {
    const item = getCalendarEventDisplayItem(event, now);
    if (item) displayable.push(item);
    else invalidCount += 1;
  }

  displayable.sort(byScheduleOrder);

  const allDay = displayable.filter(item => item.state === 'allDay');
  const current = displayable.filter(item => item.state === 'current');
  const upcoming = displayable.filter(item => item.state === 'upcoming');
  const earlier = displayable.filter(item => item.state === 'past');
  const primary = [...allDay, ...current, ...upcoming].sort(byScheduleOrder);

  return {
    allDay,
    current,
    upcoming,
    earlier,
    displayable,
    primary,
    hasRemainingToday: primary.length > 0,
    invalidCount,
  };
}

export function formatCalendarEventTime(
  eventOrItem: CalendarEvent | CalendarDisplayItem,
  mode: CalendarDisplayMode = 'today',
): string {
  const item = 'event' in eventOrItem
    ? eventOrItem
    : getCalendarEventDisplayItem(eventOrItem, new Date());

  if (!item) return '';
  if (item.state === 'allDay') {
    return mode === 'upcoming'
      ? `${format(item.start, 'MMM d')} · All day`
      : 'All day';
  }

  if (!item.end) return '';
  const timeLabel = `${format(item.start, 'HH:mm')} – ${format(item.end, 'HH:mm')}`;
  return mode === 'upcoming'
    ? `${format(item.start, 'MMM d')} · ${timeLabel}`
    : timeLabel;
}
