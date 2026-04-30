import express from 'express';
import { google } from 'googleapis';

import { ENABLE_DEBUG_ENDPOINTS, isProduction } from '../config.ts';
import { getCookie, parseJsonCookie } from '../lib/cookies.ts';
import { getOAuth2Client } from '../lib/googleOAuth.ts';
import { cacheGet, tokenKey } from '../lib/apiCache.ts';
import { createAuthedGoogleClient, getGoogleTokensFromCookie, parseAccountId, type GoogleAccountId } from '../lib/googleClient.ts';
import { logger } from '../lib/logger.ts';

// Cache calendar events for 45 s — short enough to feel live, long enough to
// avoid hammering the N+1 Google API calls on every page load / refresh.
const CALENDAR_TTL_MS = 45_000;
// Calendar list changes rarely; cache the IDs longer to avoid an extra API call per refresh.
const CALENDAR_LIST_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export const calendarRouter = express.Router();

type CalendarListItem = {
  id: string;
  summary: string | null;
  primary: boolean;
  selected: boolean;
  hidden: boolean;
  accessRole: string | null;
  timeZone: string | null;
};

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

function queryStringParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function addDaysKey(day: string, deltaDays: number): string {
  const [yS, mS, dS] = day.split('-');
  const y = Number(yS), m = Number(mS), d = Number(dS);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays, 0, 0, 0, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** RFC3339 bounds for one calendar day (client tz when provided). */
function resolveCalendarBounds(req: express.Request): {
  timeMin: string;
  timeMax: string;
  timeZone: string;
  dayStartUtcMs: number;
  dayEndUtcMs: number;
  mode: 'day' | 'upcoming';
} {
  const upcomingDaysRaw = queryStringParam(req.query.upcomingDays);
  const upcomingDays = upcomingDaysRaw ? Number(upcomingDaysRaw) : null;
  const qDay = queryStringParam(req.query.day);
  const qTz = queryStringParam(req.query.tz)?.trim() ?? '';

  if (Number.isFinite(upcomingDays) && upcomingDays != null && upcomingDays > 0 && upcomingDays <= 14) {
    const timeZone = isValidTimeZone(qTz) ? qTz : Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = Date.now();
    const max = now + upcomingDays * 24 * 60 * 60 * 1000;
    return {
      timeMin: new Date(now).toISOString(),
      timeMax: new Date(max).toISOString(),
      timeZone,
      dayStartUtcMs: now,
      dayEndUtcMs: max,
      mode: 'upcoming',
    };
  }

  if (isValidDay(qDay) && isValidTimeZone(qTz)) {
    const timeZone = qTz;
    const startUtc = utcMsForZonedMidnight(qDay, timeZone);
    const nextKey = addDaysKey(qDay, 1);
    const nextStartUtc = utcMsForZonedMidnight(nextKey, timeZone);
    // Google Calendar timeMax is exclusive (events with start < timeMax are returned).
    return {
      timeMin: new Date(startUtc).toISOString(),
      timeMax: new Date(nextStartUtc).toISOString(),
      timeZone,
      dayStartUtcMs: startUtc,
      dayEndUtcMs: nextStartUtc,
      mode: 'day',
    };
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfDay);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const dayStartUtcMs = startOfDay.getTime();
  const dayEndUtcMs = startOfTomorrow.getTime();
  return {
    timeMin: startOfDay.toISOString(),
    timeMax: startOfTomorrow.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    dayStartUtcMs,
    dayEndUtcMs,
    mode: 'day',
  };
}

function eventInRangeOrOverlaps(
  e: { start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string } },
  bounds: ReturnType<typeof resolveCalendarBounds>,
): boolean {
  if (bounds.mode === 'upcoming') return true;
  const { dayStartUtcMs, dayEndUtcMs, timeZone } = bounds;
  const s = e.start?.dateTime ?? e.start?.date ?? null;
  const en = e.end?.dateTime ?? e.end?.date ?? null;
  if (!s || !en) return false;

  const startMs = (() => {
    if (e.start?.dateTime) return Date.parse(s);
    // all-day start date in tz
    return utcMsForZonedMidnight(s, timeZone);
  })();
  const endMs = (() => {
    if (e.end?.dateTime) return Date.parse(en);
    // all-day end.date is exclusive
    return utcMsForZonedMidnight(en, timeZone);
  })();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return endMs > dayStartUtcMs && startMs < dayEndUtcMs;
}

calendarRouter.get('/events', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  const bounds = resolveCalendarBounds(req);
  const debug = !isProduction && queryStringParam(req.query.debug) === '1';
  const calendarIdsParam = queryStringParam(req.query.calendarIds);
  const calendarIdsRequested = calendarIdsParam
    ? calendarIdsParam.split(',').map(s => s.trim()).filter(Boolean).slice(0, 20)
    : null;

  try {
    const { tokensCookie, tokens } = auth;

    // Cache must include the query window — previously a single key reused wrong/stale days and hid API failures as empty lists.
    const cacheKey = tokenKey(
      `${accountId}:${tokens.refresh_token ?? tokensCookie}`,
      `calendar:events:${bounds.timeMin}|${bounds.timeMax}|${bounds.timeZone}|${calendarIdsRequested?.join('|') ?? 'auto'}`,
    );
    const debugCacheKey = debug ? `${cacheKey}:debug` : cacheKey;

    const result = debug
      ? await (async () => {
          // Skip caching for debug so the output always reflects current upstream responses.
          const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);
          const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
          const { timeZone } = bounds;
          const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
          const items = calListRes.data.items ?? [];
          const autoIds = (items ?? [])
            .filter(c => c.hidden !== true)
            .filter(c => c.selected !== false)
            .map(c => c.id!)
            .filter(Boolean);
          const ids = Array.from(new Set(calendarIdsRequested?.length ? calendarIdsRequested : ['primary', ...(autoIds.length ? autoIds : ['primary'])]));

          // Fetch wider window so we still capture events that overlap today but start before timeMin.
          const debugFetchMin = new Date(bounds.dayStartUtcMs - 24 * 60 * 60 * 1000).toISOString();
          const debugFetchMax = new Date(bounds.dayEndUtcMs + 24 * 60 * 60 * 1000).toISOString();

          const settled = await Promise.allSettled(
            ids.map(calendarId =>
              calendar.events.list({
                calendarId,
                timeMin: debugFetchMin,
                timeMax: debugFetchMax,
                timeZone,
                maxResults: 50,
                singleEvents: true,
                orderBy: 'startTime',
              }),
            ),
          );
          const eventArrays = settled.flatMap(s => (s.status === 'fulfilled' ? (s.value.data.items ?? []) : []));
          const seen = new Set<string>();
          const events = eventArrays
            .filter(e => e != null)
            .filter(e => eventInRangeOrOverlaps(e, bounds))
            .filter(e => {
              const key = e.iCalUID ?? e.id;
              if (!key) return true;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            })
            .sort((a, b) => {
              const aTime = a.start?.dateTime ?? a.start?.date ?? '';
              const bTime = b.start?.dateTime ?? b.start?.date ?? '';
              return aTime.localeCompare(bTime);
            });

          const perCalendar = settled.map((s, idx) => {
            const calendarId = ids[idx]!;
            const metaItem = items.find(i => i.id === calendarId);
            const meta = metaItem
              ? {
                  summary: metaItem.summary,
                  primary: !!metaItem.primary,
                  selected: !!metaItem.selected,
                  hidden: !!metaItem.hidden,
                  accessRole: metaItem.accessRole,
                  timeZone: metaItem.timeZone,
                }
              : undefined;
            if (s.status === 'rejected') {
              const e = s.reason as { message?: string; response?: { status?: number } };
              return { calendarId, meta, error: e?.message ?? String(s.reason), status: e?.response?.status };
            }
            const evs = (s.value.data.items ?? []).filter(e => eventInRangeOrOverlaps(e, bounds));
            return {
              calendarId,
              meta,
              count: evs.length,
              sample: evs.slice(0, 5).map(e => ({ id: e.id, iCalUID: e.iCalUID, summary: e.summary, start: e.start, end: e.end })),
            };
          });

          return {
            events,
            __debug: {
              accountId,
              bounds,
              queriedCalendars: ids.length,
              totalEventsReturned: events.length,
              calendarIdsRequested,
              calendars: items.slice(0, 50).map(i => ({
                id: i.id,
                summary: i.summary,
                primary: !!i.primary,
                selected: i.selected !== false,
                hidden: i.hidden === true,
                accessRole: i.accessRole ?? null,
                timeZone: i.timeZone ?? null,
              })),
              perCalendar,
            },
          };
        })()
      : await cacheGet(debugCacheKey, CALENDAR_TTL_MS, async () => {
      const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);

      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      const { timeZone } = bounds;
      const fetchMin = new Date(bounds.dayStartUtcMs - 24 * 60 * 60 * 1000).toISOString();
      const fetchMax = new Date(bounds.dayEndUtcMs + 24 * 60 * 60 * 1000).toISOString();

      // Fetch all accessible calendars (cached), then query each in parallel
      const listCacheKey = tokenKey(tokens.refresh_token ?? tokensCookie, 'calendar:list');
      const calendarIds = await cacheGet(listCacheKey, CALENDAR_LIST_TTL_MS, async () => {
        const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
        const items = (calListRes.data.items ?? []);
        const ids = items
          .filter(c => c.hidden !== true)
          .filter(c => c.selected !== false)
          .map(c => c.id!)
          .filter(Boolean);
        // Always include primary, even if not in the list for some reason.
        const uniq = Array.from(new Set(['primary', ...ids]));
        return uniq.length ? uniq : ['primary'];
      });

      const idsToQuery = Array.from(new Set(calendarIdsRequested?.length ? calendarIdsRequested : calendarIds));

      const settled = await Promise.allSettled(
        idsToQuery.map(calId =>
          calendar.events.list({
            calendarId: calId,
            timeMin: fetchMin,
            timeMax: fetchMax,
            timeZone,
            maxResults: 50,
            singleEvents: true,
            orderBy: 'startTime',
          }),
        ),
      );

      for (let i = 0; i < settled.length; i++) {
        const s = settled[i]!;
        if (s.status === 'rejected') {
          logger.warn({ calId: idsToQuery[i], reason: s.reason }, 'calendar.events.list failed');
        }
      }

      const allRejected =
        settled.length > 0 && settled.every((x): x is PromiseRejectedResult => x.status === 'rejected');
      if (allRejected) throw (settled[0] as PromiseRejectedResult).reason;

      const eventArrays = settled.flatMap(s =>
        s.status === 'fulfilled' ? (s.value.data.items ?? []) : [],
      );

      // Dedupe when Google gives stable ids; don't drop events missing both id and iCalUID.
      const seen = new Set<string>();
      const allEvents = eventArrays
        .filter(e => e != null)
        .filter(e => eventInRangeOrOverlaps(e, bounds))
        .filter(e => {
          const key = e.iCalUID ?? e.id;
          if (!key) return true;
          if (seen.has(key)) return false;
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
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; code?: string; cause?: { message?: string }; message?: string };
    const status = err?.response?.status ?? err?.code;
    const causeMsg: string = err?.cause?.message ?? err?.message ?? '';
    if (causeMsg.includes('disabled') || causeMsg.includes('has not been used')) {
      return res.status(503).json({ error: 'Google Calendar API is not enabled in your Cloud project', code: 'API_DISABLED' });
    }
    if (status === 401 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    if (status === 403) {
      return res.status(403).json({
        error: 'Google Calendar access denied — reconnect Google in Integrations',
        code: 'CALENDAR_FORBIDDEN',
      });
    }
    logger.error({ error }, 'Error fetching calendar events');
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

calendarRouter.get('/calendars', async (req, res) => {
  const accountId = parseAccountId(req.query.accountId);
  const auth = getGoogleTokensFromCookie(req, accountId);
  if (!auth) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { tokensCookie, tokens } = auth;
    const cacheKey = tokenKey(`${accountId}:${tokens.refresh_token ?? tokensCookie}`, 'calendar:calendars');
    const result = await cacheGet(cacheKey, 10 * 60_000, async () => {
      const oauth2Client = createAuthedGoogleClient(req, res, tokens, accountId);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
      const calListRes = await calendar.calendarList.list({ minAccessRole: 'reader' });
      const items = calListRes.data.items ?? [];
      const calendars: CalendarListItem[] = items
        .map(i => ({
          id: i.id!,
          summary: i.summary ?? null,
          primary: !!i.primary,
          selected: i.selected !== false,
          hidden: i.hidden === true,
          accessRole: i.accessRole ?? null,
          timeZone: i.timeZone ?? null,
        }))
        .filter(i => !!i.id)
        .sort((a, b) => Number(b.primary) - Number(a.primary) || String(a.summary ?? '').localeCompare(String(b.summary ?? '')));
      return { accountId, calendars };
    });
    res.json(result);
  } catch (error: unknown) {
    const err = error as { response?: { status?: number }; code?: string; message?: string };
    const status = err?.response?.status ?? err?.code;
    if (status === 401 || err?.message?.includes('invalid_grant')) {
      return res.status(401).json({ error: 'Token expired or invalid' });
    }
    if (status === 403) {
      return res.status(403).json({ error: 'Google Calendar access denied — reconnect Google in Integrations', code: 'CALENDAR_FORBIDDEN' });
    }
    logger.error({ error }, 'Error fetching calendar list');
    res.status(500).json({ error: 'Failed to fetch calendars' });
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
    const startOfTomorrow = new Date(startOfDay);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const timeMin = startOfDay.toISOString();
    const timeMax = startOfTomorrow.toISOString();
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
    })).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

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
      } catch (err: unknown) {
        const li = items.find(c => c.id === calendarId);
        const meta = li ? {
          primary: !!li.primary,
          selected: !!li.selected,
          hidden: !!li.hidden,
          accessRole: li.accessRole,
          summary: li.summary,
          timeZone: li.timeZone,
        } : (calendarId === 'primary' ? { primary: true } : undefined);
        return { calendarId, meta, error: err instanceof Error ? err.message : String(err) };
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
    }).catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));

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
  } catch (error: unknown) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'debug_failed' });
  }
});
