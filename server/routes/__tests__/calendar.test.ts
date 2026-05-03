import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';
import type { calendar_v3 } from 'googleapis';

import { SESSION_SECRET } from '../../config';
import { __testOnly, calendarRouter } from '../calendar';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser(SESSION_SECRET));
  // calendarRouter expects requireDashboardAccess upstream in real app, but we can hit it directly.
  app.use('/api/calendar', calendarRouter);
  return app;
}

describe('Calendar routes', () => {
  it('defaults to readable non-hidden calendars even when Google marks them unselected', () => {
    expect(__testOnly.defaultCalendarIdsFromList([
      { id: 'primary', selected: true },
      { id: 'work-shifts', selected: false },
      { id: 'hidden-calendar', hidden: true },
      { id: 'deleted-calendar', deleted: true },
    ])).toEqual(['primary', 'work-shifts']);
  });

  it('pages through calendar event results instead of stopping at the first page', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'first', start: { dateTime: '2026-05-01T08:00:00' }, end: { dateTime: '2026-05-01T09:00:00' } }],
          nextPageToken: 'page-2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'second', start: { dateTime: '2026-05-01T10:00:00' }, end: { dateTime: '2026-05-01T11:00:00' } }],
        },
      });

    const events = await __testOnly.listCalendarEvents({
      events: { list },
    } as unknown as calendar_v3.Calendar, {
      calendarId: 'primary',
      timeMin: '2026-05-01T00:00:00Z',
      timeMax: '2026-05-02T00:00:00Z',
      timeZone: 'America/New_York',
    });

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0]).toMatchObject({ pageToken: 'page-2' });
    expect(events.map(event => event.id)).toEqual(['first', 'second']);
  });

  it('pages through calendar list results so late subscription calendars are included', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'primary', summary: 'Primary' }],
          nextPageToken: 'page-2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          items: [{ id: 'w2w-schedule', summary: 'W2W Schedule' }],
        },
      });

    const calendars = await __testOnly.listReadableCalendars({
      calendarList: { list },
    } as unknown as calendar_v3.Calendar);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[0][0]).toMatchObject({ maxResults: 250, minAccessRole: 'reader' });
    expect(list.mock.calls[1][0]).toMatchObject({ pageToken: 'page-2' });
    expect(calendars.map(calendar => calendar.id)).toEqual(['primary', 'w2w-schedule']);
  });

  it('keeps auto calendar list cache short so new shared calendars appear quickly', () => {
    expect(__testOnly.CALENDAR_LIST_TTL_MS).toBe(5 * 60 * 1000);
  });

  describe('GET /api/calendar/events', () => {
    it('returns 401 without tokens cookie', async () => {
      const res = await request(makeApp()).get('/api/calendar/events');
      expect(res.status).toBe(401);
    });

    it('accepts accountId and query params (still 401 when unauthenticated)', async () => {
      const res = await request(makeApp()).get('/api/calendar/events?accountId=secondary&day=2026-04-29&tz=America%2FNew_York&upcomingDays=7');
      expect(res.status).toBe(401);
    });

    it('limits calendarIds parsing and remains 401 when unauthenticated', async () => {
      const many = Array.from({ length: 50 }, (_, i) => `cal_${i}`).join(',');
      const res = await request(makeApp()).get(`/api/calendar/events?calendarIds=${encodeURIComponent(many)}`);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/calendar/calendars', () => {
    it('returns 401 without tokens cookie', async () => {
      const res = await request(makeApp()).get('/api/calendar/calendars');
      expect(res.status).toBe(401);
    });
  });
});
