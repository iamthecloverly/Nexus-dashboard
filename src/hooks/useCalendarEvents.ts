import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarEvent } from '../types/calendar';
import { apiFetchJson } from '../lib/apiFetch';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { markSyncStatus } from '../lib/dashboardFeatures';

const CALENDAR_VISIBLE_REFRESH_MS = 60_000;
const CALENDAR_SELECTION_VERSION = '2';

/** Today's date as YYYY-MM-DD in the given IANA timezone (aligns with server calendar window). */
function calendarDayInTimeZone(timeZone: string, date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  let y = '';
  let m = '';
  let d = '';
  for (const p of parts) {
    if (p.type === 'year') y = p.value;
    if (p.type === 'month') m = p.value;
    if (p.type === 'day') d = p.value;
  }
  if (!y || !m || !d) return '';
  return `${y}-${m}-${d}`;
}

function localCalendarDayStamp(date = new Date()): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = timeZone ? calendarDayInTimeZone(timeZone, date) : '';
    return timeZone && day ? `${timeZone}:${day}` : date.toDateString();
  } catch {
    return date.toDateString();
  }
}

function msUntilNextLocalDay(now = new Date()): number {
  const next = new Date(now);
  next.setHours(24, 0, 5, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

function calendarEventsUrl(opts: { accountId?: 'primary' | 'secondary'; calendarIds?: string[] } = {}): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return '/api/calendar/events';
    const day = calendarDayInTimeZone(tz);
    if (!day) return '/api/calendar/events';
    const q = new URLSearchParams({ day, tz });
    if (opts.accountId) q.set('accountId', opts.accountId);
    if (opts.calendarIds && opts.calendarIds.length) q.set('calendarIds', opts.calendarIds.join(','));
    return `/api/calendar/events?${q.toString()}`;
  } catch {
    return '/api/calendar/events';
  }
}

export type CalendarError =
  | 'login_required'
  | 'not_connected'
  | 'not_allowlisted'
  | 'google_profile_missing'
  | 'forbidden'
  | 'calendar_access_denied'
  | 'api_disabled'
  | 'fetch_error'
  | 'network_error';

interface CalendarState {
  events: CalendarEvent[];
  isLoading: boolean;
  isConnected: boolean;
  error: CalendarError | null;
  mode: 'today';
  accountId: 'primary' | 'secondary';
  mainCalendarId: string | null;
  includedCalendarIds: string[] | null;
  setAccountId: (id: 'primary' | 'secondary') => void;
  setMainCalendarId: (id: string | null) => void;
  setIncludedCalendarIds: (ids: string[] | null) => void;
  refetch: () => void;
}

function readJsonArray(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const out = v.filter(x => typeof x === 'string').map(s => s.trim()).filter(Boolean).slice(0, 20);
    return out.length ? out : null;
  } catch {
    return null;
  }
}

function mainIdKey(id: 'primary' | 'secondary') {
  return `${STORAGE_KEYS.calendarMainId}_${id}`;
}
function includedIdsKey(id: 'primary' | 'secondary') {
  return `${STORAGE_KEYS.calendarIncludedIds}_${id}`;
}

function migrateCalendarSelectionStorage() {
  try {
    if (localStorage.getItem(STORAGE_KEYS.calendarSelectionVersion) === CALENDAR_SELECTION_VERSION) return;
    for (const id of ['primary', 'secondary'] as const) {
      localStorage.removeItem(mainIdKey(id));
      localStorage.removeItem(includedIdsKey(id));
    }
    localStorage.setItem(STORAGE_KEYS.calendarSelectionVersion, CALENDAR_SELECTION_VERSION);
  } catch {
    // Storage can be unavailable in private contexts; fall back to runtime defaults.
  }
}

export function useCalendarEvents(): CalendarState {
  migrateCalendarSelectionStorage();

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<CalendarError | null>(null);
  const requestSeqRef = useRef(0);
  const lastFetchedDayRef = useRef<string | null>(null);

  const initAccountId: 'primary' | 'secondary' = (() => {
    const v = localStorage.getItem(STORAGE_KEYS.calendarAccount);
    return v === 'secondary' ? 'secondary' : 'primary';
  })();

  const [accountId, setAccountIdState] = useState<'primary' | 'secondary'>(initAccountId);
  const [mainCalendarId, setMainCalendarId] = useState<string | null>(() => {
    const v = localStorage.getItem(mainIdKey(initAccountId));
    return v && v.trim() ? v : null;
  });
  const [includedCalendarIds, setIncludedCalendarIds] = useState<string[] | null>(() => readJsonArray(includedIdsKey(initAccountId)));

  const setAccountId = useCallback((id: 'primary' | 'secondary') => {
    setAccountIdState(id);
    const v = localStorage.getItem(mainIdKey(id));
    setMainCalendarId(v && v.trim() ? v : null);
    setIncludedCalendarIds(readJsonArray(includedIdsKey(id)));
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.calendarAccount, accountId); }, [accountId]);
  useEffect(() => {
    if (mainCalendarId) localStorage.setItem(mainIdKey(accountId), mainCalendarId);
    else localStorage.removeItem(mainIdKey(accountId));
  }, [mainCalendarId, accountId]);
  useEffect(() => {
    if (includedCalendarIds && includedCalendarIds.length) localStorage.setItem(includedIdsKey(accountId), JSON.stringify(includedCalendarIds));
    else localStorage.removeItem(includedIdsKey(accountId));
  }, [includedCalendarIds, accountId]);

  const refetch = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    const requestDayStamp = localCalendarDayStamp();
    const isStale = () => requestId !== requestSeqRef.current;
    setIsLoading(true);
    setError(null);
    try {
      const opts = {
        accountId,
        calendarIds: includedCalendarIds ?? (mainCalendarId ? [mainCalendarId] : undefined),
      };
      const result = await apiFetchJson<{ events?: CalendarEvent[] }>(calendarEventsUrl(opts), { timeoutMs: 15_000 });
      if (isStale()) return;
      lastFetchedDayRef.current = requestDayStamp;
      if ('error' in result) {
        const err = result.error;
        markSyncStatus('calendar', 'error', err.error ?? `HTTP ${err.status}`);
        if (err.status === 401) {
          const code = err.code ?? '';
          const msg = err.error ?? '';
          setIsConnected(false);
          if (code === 'LOGIN_REQUIRED' || msg.toLowerCase().includes('login required')) setError('login_required');
          else setError('not_connected');
        } else if (err.status === 403) {
          const code = err.code ?? '';
          const msg = err.error ?? '';
          if (code === 'CALENDAR_FORBIDDEN') {
            setIsConnected(true);
            setError('calendar_access_denied');
          } else {
            setIsConnected(false);
            if (code === 'GOOGLE_NOT_ALLOWLISTED' || msg.toLowerCase().includes('not allowed')) setError('not_allowlisted');
            else if (code === 'GOOGLE_PROFILE_MISSING' || msg.toLowerCase().includes('not connected')) setError('google_profile_missing');
            else setError('forbidden');
          }
        } else if (err.status === 503) {
          setIsConnected(true);
          setError(err.code === 'API_DISABLED' ? 'api_disabled' : 'fetch_error');
        } else {
          setIsConnected(true);
          setError('fetch_error');
        }
      } else {
        const todays = result.data.events ?? [];
        setEvents(todays);
        setIsConnected(true);
        markSyncStatus('calendar', 'ok');
      }
    } catch {
      if (isStale()) return;
      lastFetchedDayRef.current = requestDayStamp;
      setIsConnected(false);
      setError('network_error');
      markSyncStatus('calendar', 'error', 'Network error');
    } finally {
      if (!isStale()) setIsLoading(false);
    }
  }, [accountId, includedCalendarIds, mainCalendarId]);

  useEffect(() => { refetch(); }, [refetch]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refetch();
    }, CALENDAR_VISIBLE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [refetch]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let timeoutId: number | undefined;

    const scheduleNextRollover = () => {
      timeoutId = window.setTimeout(() => {
        refetch();
        scheduleNextRollover();
      }, msUntilNextLocalDay());
    };

    scheduleNextRollover();
    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [refetch]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const fetchedDay = lastFetchedDayRef.current;
      if (fetchedDay && fetchedDay !== localCalendarDayStamp()) refetch();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refetch]);

  return {
    events,
    isLoading,
    isConnected,
    error,
    mode: 'today',
    accountId,
    mainCalendarId,
    includedCalendarIds,
    setAccountId,
    setMainCalendarId,
    setIncludedCalendarIds,
    refetch,
  };
}

export const __testOnly = {
  calendarDayInTimeZone,
  localCalendarDayStamp,
  msUntilNextLocalDay,
};
