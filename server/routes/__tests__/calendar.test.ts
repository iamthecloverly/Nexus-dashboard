import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import cookieParser from 'cookie-parser';

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
