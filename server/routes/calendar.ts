import express from 'express';
import { google } from 'googleapis';

import { ENABLE_DEBUG_ENDPOINTS, isProduction } from '../config.ts';
import { getCookie, parseJsonCookie } from '../lib/cookies.ts';
import { getOAuth2Client } from '../lib/googleOAuth.ts';
import { cacheGet, tokenKey } from '../lib/apiCache.ts';
import { createAuthedGoogleClient, getGoogleTokensFromCookie } from '../lib/googleClient.ts';

// Cache calendar events for 45 s — short enough to feel live, long enough to
// avoid hammering the N+1 Google API calls on every page load / refresh.
const CALENDAR_TTL_MS = 45_000;
// Calendar list changes rarely; cache the IDs longer to avoid an extra API call per refresh.
const CALENDAR_LIST_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export const calendarRouter = express.Router();

function isValidDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    // Throws RangeError on invalid IANA timezone name
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

function partsInTimeZone(date: Date, timeZone: string): Record<string, number> {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(date);
  const out: Record<string, number> = {};
  for (const p of parts) {
    if (p.type === 'literal') continue;
    out[p.type] = Number(p.value);
  }
  return out;
}

/**
 * Convert "YYYY-MM-DD 00:00:00" in a given IANA timezone to a UTC timestamp (ms).
 * Minimal dependency-free approximation using iterative offset correction.
 */
function utcMsForZonedMidnight(day: string, timeZone: string): number {
  const [yS, mS, dS] = day.split('-');
  const y = Number(yS), m = Number(mS), d = Number(dS);
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);

  // Iterate a few times to converge across DST boundaries.
  for (let i = 0; i < 6; i++) {
    const p = partsInTimeZone(new Date(guess), timeZone);
    const localY = p.year, localM = p.month, localD = p.day;
    const localH = p.hour ?? 0, localMin = p.minute ?? 0, localS = p.second ?? 0;

    const localMs = Date.UTC(localY, localM - 1, localD, localH, localMin, localS, 0);
    const targetLocalMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0);

    const deltaMs = localMs - targetLocalMs;
    if (deltaMs === 0) break;
    guess -= deltaMs;
  }

  return guess;
}

calendarRouter.get('/events', async (req, res) => {
  const auth = getGoogleTokensFromCookie(req);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { tokensCookie, tokens } = auth;

    // Use refresh_token as the stable identity key (doesn't rotate on refresh).
    const cacheKey = tokenKey(tokens.refresh_token ?? tokensCookie, 'calendar:events');

    const result = await cacheGet(cacheKey, CALENDAR_TTL_MS, async () => {
      const oauth2Client = createAuthedGoogleClient(req, res, tokens);

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      // Prefer client-supplied "day" + "tz" so "today" aligns with the user's timezone.
      // Falls back to server-local behavior if missing/invalid.
      let timeMin: string;
      let timeMax: string;
      let timeZone: string;

      const qDay = req.query.day;
      const qTz = req.query.tz;
      if (isValidDay(qDay) && isValidTimeZone(qTz)) {
        timeZone = qTz;
        const startUtc = utcMsForZonedMidnight(qDay, timeZone);
        // Compute end as next day's midnight minus 1ms (handles DST days not equal to 24h)
        const [yS, mS, dS] = qDay.split('-');
        const y = Number(yS), m = Number(mS), d = Number(dS);
        const nextDay = new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0, 0));
        const nextKey = `${nextDay.getUTCFullYear()}-${String(nextDay.getUTCMonth() + 1).padStart(2, '0')}-${String(nextDay.getUTCDate()).padStart(2, '0')}`;
        const nextStartUtc = utcMsForZonedMidnight(nextKey, timeZone);
        timeMin = new Date(startUtc).toISOString();
        timeMax = new Date(nextStartUtc - 1).toISOString();
      } else {
        // Fallback: server-local day boundaries (may be incorrect when server TZ != user TZ)
        const now = new Date();
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        timeMin = startOfDay.toISOString();
        timeMax = endOfDay.toISOString();
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      }

      // Fetch all accessible calendars (cached), then query each in parallel
      const listCacheKey = tokenKey(tokens.refresh_token ?? tokensCookie, 'calendar:list');
      const calendarIds = await cacheGet(listCacheKey, CALENDAR_LIST_TTL_MS, async () => {
        const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
        const ids = (calListRes.data.items ?? []).map(c => c.id!).filter(Boolean);
        return ids.length ? ids : ['primary'];
      });

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
