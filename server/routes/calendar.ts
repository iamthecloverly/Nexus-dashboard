import express from 'express';
import { google } from 'googleapis';

import { COOKIE_OPTS, ENABLE_DEBUG_ENDPOINTS, isProduction } from '../config.ts';
import { getCookie, parseJsonCookie, setSignedCookie } from '../lib/cookies.ts';
import { getOAuth2Client } from '../lib/googleOAuth.ts';
import { cacheGet, tokenKey } from '../lib/apiCache.ts';

// Cache calendar events for 45 s — short enough to feel live, long enough to
// avoid hammering the N+1 Google API calls on every page load / refresh.
const CALENDAR_TTL_MS = 45_000;

export const calendarRouter = express.Router();

calendarRouter.get('/events', async (req, res) => {
  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const tokens = parseJsonCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });

    // Use refresh_token as the stable identity key (doesn't rotate on refresh).
    const cacheKey = tokenKey(tokens.refresh_token ?? tokensCookie, 'calendar:events');

    const result = await cacheGet(cacheKey, CALENDAR_TTL_MS, async () => {
      const oauth2Client = getOAuth2Client(req);
      oauth2Client.setCredentials(tokens);
      oauth2Client.once('tokens', (newTokens) => {
        setSignedCookie(res, 'google_tokens', JSON.stringify({ ...tokens, ...newTokens }), COOKIE_OPTS);
      });

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Get events for today using local start/end-of-day converted to UTC ISO strings.
      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      const timeMin = startOfDay.toISOString();
      const timeMax = endOfDay.toISOString();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      // Fetch all accessible calendars, then query each in parallel
      const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
      const calendarIds = (calListRes.data.items ?? []).map(c => c.id!).filter(Boolean);
      if (!calendarIds.length) calendarIds.push('primary');

      const eventArrays = await Promise.all(
        calendarIds.map(calId =>
          calendar.events.list({
            calendarId: calId,
            timeMin,
            timeMax,
            timeZone,
            maxResults: 50,
            singleEvents: true,
            orderBy: 'startTime',
          }).then(r => r.data.items ?? []).catch(() => [])
        )
      );

      // Flatten, deduplicate by iCalUID, sort by start time
      const seen = new Set<string>();
      const allEvents = eventArrays.flat()
        .filter(e => {
          const key = e.iCalUID ?? e.id;
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => {
          const aTime = a.start?.dateTime ?? a.start?.date ?? '';
          const bTime = b.start?.dateTime ?? b.start?.date ?? '';
          return aTime.localeCompare(bTime);
        });

      return { events: allEvents };
    });

    res.json(result);
  } catch (error: any) {
    const status = error?.response?.status ?? error?.code;
    const causeMsg: string = error?.cause?.message ?? error?.message ?? '';
    if (causeMsg.includes('disabled') || causeMsg.includes('has not been used')) {
      return res.status(503).json({ error: 'Google Calendar API is not enabled in your Cloud project', code: 'API_DISABLED' });
    }
    if (status === 401 || error?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    console.error('Error fetching calendar events:', error);
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// Debug endpoint to diagnose "No events today" issues (dev only).
// Must be explicitly enabled via ENABLE_DEBUG_ENDPOINTS=true
calendarRouter.get('/debug', async (req, res) => {
  if (isProduction || !ENABLE_DEBUG_ENDPOINTS) return res.status(404).json({ error: 'Not found' });

  const tokensCookie = getCookie(req, 'google_tokens');
  if (!tokensCookie) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const tokens = parseJsonCookie(tokensCookie);
    if (!tokens) return res.status(401).json({ error: 'Invalid session, please reconnect' });
    const oauth2Client = getOAuth2Client(req);
    oauth2Client.setCredentials(tokens);

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    const timeMin = startOfDay.toISOString();
    const timeMax = endOfDay.toISOString();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
    const items = calListRes.data.items ?? [];
    const calendarIds = items.map(c => c.id!).filter(Boolean);
    const ids = calendarIds.length ? calendarIds : ['primary'];
    const uniqueIds = Array.from(new Set(['primary', ...ids]));

    const primaryMeta = await calendar.calendars.get({ calendarId: 'primary' }).then(r => ({
      id: r.data.id,
      summary: r.data.summary,
      timeZone: r.data.timeZone,
    })).catch((err: any) => ({ error: err?.message ?? String(err) }));

    const perCalendar = await Promise.all(uniqueIds.map(async (calendarId) => {
      try {
        const r = await calendar.events.list({
          calendarId,
          timeMin,
          timeMax,
          timeZone,
          maxResults: 50,
          singleEvents: true,
          orderBy: 'startTime',
        });
        const evs = r.data.items ?? [];
        const sample = evs.slice(0, 5).map(e => ({
          id: e.id,
          iCalUID: e.iCalUID,
          summary: e.summary,
          start: e.start,
          end: e.end,
        }));
        const meta = calendarId === 'primary'
          ? { primary: true }
          : (() => {
              const li = items.find(c => c.id === calendarId);
              return li ? {
                primary: !!li.primary,
                selected: !!li.selected,
                hidden: !!li.hidden,
                accessRole: li.accessRole,
                summary: li.summary,
                timeZone: li.timeZone,
              } : undefined;
            })();
        return { calendarId, meta, count: evs.length, sample };
      } catch (err: any) {
        const li = items.find(c => c.id === calendarId);
        const meta = li ? {
          primary: !!li.primary,
          selected: !!li.selected,
          hidden: !!li.hidden,
          accessRole: li.accessRole,
          summary: li.summary,
          timeZone: li.timeZone,
        } : (calendarId === 'primary' ? { primary: true } : undefined);
        return { calendarId, meta, error: err?.message ?? String(err) };
      }
    }));

    const freeBusy = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: 'primary' }],
      },
    }).then(r => {
      const calendars = r.data.calendars ?? {};
      const pick = (id: string) => ({
        errors: calendars[id]?.errors,
        busyCount: (calendars[id]?.busy ?? []).length,
        busySample: (calendars[id]?.busy ?? []).slice(0, 5),
      });
      return { primary: pick('primary') };
    }).catch((err: any) => ({ error: err?.message ?? String(err) }));

    res.json({
      now: now.toISOString(),
      timeZone,
      timeMin,
      timeMax,
      calendarsQueried: uniqueIds.length,
      primaryMeta,
      calendarListSample: items.slice(0, 10).map(c => ({
        id: c.id,
        primary: c.primary,
        selected: c.selected,
        hidden: c.hidden,
        accessRole: c.accessRole,
        summary: c.summary,
        timeZone: c.timeZone,
      })),
      perCalendar,
      freeBusy,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message ?? 'debug_failed' });
  }
});
