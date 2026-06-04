import { useState, useEffect, useCallback, useRef } from 'react';
import type { CalendarEvent } from '../types/calendar';
import { apiFetchJson, type ApiError } from '../lib/apiFetch';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { markSyncStatus } from '../lib/dashboardFeatures';
import { calendarEventOverlapsLocalDay } from '../lib/calendarDisplay';

const CALENDAR_VISIBLE_REFRESH_MS = 60_000;
const CALENDAR_SELECTION_VERSION = '4';
type CalendarAccountId = 'primary' | 'secondary';
type CalendarFetchReason = 'initial' | 'manual' | 'background';

type CalendarAccountMode = 'selected' | 'allConnected';

interface UseCalendarEventsOptions {
  accountMode?: CalendarAccountMode;
  respectSavedFilters?: boolean;
}

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

function calendarEventsUrl(opts: { accountId?: CalendarAccountId; calendarIds?: string[]; forceRefresh?: boolean } = {}, date = new Date()): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return '/api/calendar/events';
    const day = calendarDayInTimeZone(tz, date);
    if (!day) return '/api/calendar/events';
    const q = new URLSearchParams({ day, tz });
    if (opts.accountId) q.set('accountId', opts.accountId);
    if (opts.calendarIds && opts.calendarIds.length) q.set('calendarIds', opts.calendarIds.join(','));
    if (opts.forceRefresh) q.set('refresh', '1');
    return `/api/calendar/events?${q.toString()}`;
  } catch {
    return '/api/calendar/events';
  }
}

type CalendarError =
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
  isRefreshing: boolean;
  isConnected: boolean;
  error: CalendarError | null;
  mode: 'today';
  accountId: CalendarAccountId;
  mainCalendarId: string | null;
  includedCalendarIds: string[] | null;
  filtersActive: boolean;
  setAccountId: (id: CalendarAccountId) => void;
  setMainCalendarId: (id: string | null) => void;
  setIncludedCalendarIds: (ids: string[] | null) => void;
  refetch: () => void;
}

type GoogleAccountsResponse = {
  accounts?: Array<{ accountId: CalendarAccountId; connected?: boolean }>;
};

type CalendarAccountFetchPlan = {
  required: CalendarAccountId[];
  optional: CalendarAccountId[];
};

type CalendarEventsFetchResult = {
  accountId: CalendarAccountId;
  required: boolean;
  result: Awaited<ReturnType<typeof apiFetchJson<{ events?: CalendarEvent[] }>>>;
};

type SuccessfulCalendarEventsFetch = {
  accountId: CalendarAccountId;
  required: boolean;
  result: { ok: true; data: { events?: CalendarEvent[] } };
};

type InitialCalendarState = {
  accountId: CalendarAccountId;
  mainCalendarId: string | null;
  includedCalendarIds: string[] | null;
  needsSelectionMigration: boolean;
};

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

function mainIdKey(id: CalendarAccountId) {
  return `${STORAGE_KEYS.calendarMainId}_${id}`;
}
function includedIdsKey(id: CalendarAccountId) {
  return `${STORAGE_KEYS.calendarIncludedIds}_${id}`;
}

function isSelectionVersionCurrent(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.calendarSelectionVersion) === CALENDAR_SELECTION_VERSION;
  } catch {
    return true;
  }
}

function readCalendarFilters(id: CalendarAccountId, selectionVersionCurrent = isSelectionVersionCurrent()) {
  if (!selectionVersionCurrent) return { mainCalendarId: null, includedCalendarIds: null };
  try {
    const v = localStorage.getItem(mainIdKey(id));
    return {
      mainCalendarId: v && v.trim() ? v : null,
      includedCalendarIds: readJsonArray(includedIdsKey(id)),
    };
  } catch {
    return { mainCalendarId: null, includedCalendarIds: null };
  }
}

function readInitialCalendarState(): InitialCalendarState {
  const account = (() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.calendarAccount) === 'secondary' ? 'secondary' : 'primary';
    } catch {
      return 'primary';
    }
  })();
  const selectionVersionCurrent = isSelectionVersionCurrent();
  return {
    accountId: account,
    ...readCalendarFilters(account, selectionVersionCurrent),
    needsSelectionMigration: !selectionVersionCurrent,
  };
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

function calendarErrorState(err: ApiError): Pick<CalendarState, 'isConnected' | 'error'> {
  if (err.status === 401) {
    const code = err.code ?? '';
    const msg = err.error ?? '';
    return {
      isConnected: false,
      error: code === 'LOGIN_REQUIRED' || msg.toLowerCase().includes('login required')
        ? 'login_required'
        : 'not_connected',
    };
  }

  if (err.status === 403) {
    const code = err.code ?? '';
    const msg = err.error ?? '';
    if (code === 'CALENDAR_FORBIDDEN') return { isConnected: true, error: 'calendar_access_denied' };
    if (code === 'GOOGLE_NOT_ALLOWLISTED' || msg.toLowerCase().includes('not allowed')) {
      return { isConnected: false, error: 'not_allowlisted' };
    }
    if (code === 'GOOGLE_PROFILE_MISSING' || msg.toLowerCase().includes('not connected')) {
      return { isConnected: false, error: 'google_profile_missing' };
    }
    return { isConnected: false, error: 'forbidden' };
  }

  if (err.status === 503) {
    return { isConnected: true, error: err.code === 'API_DISABLED' ? 'api_disabled' : 'fetch_error' };
  }

  return { isConnected: true, error: 'fetch_error' };
}

function rankCalendarError(err: ApiError): number {
  if (err.code === 'LOGIN_REQUIRED') return 0;
  if (err.status === 403) return 1;
  if (err.status === 503) return 2;
  if (err.status === 401) return 3;
  return 4;
}

function normalizeAccountEvent(event: CalendarEvent, accountId: CalendarAccountId, prefixId: boolean): CalendarEvent {
  if (!prefixId) return event;
  return { ...event, id: `${accountId}:${event.id}` };
}

function uniqueAccountIds(ids: CalendarAccountId[]): CalendarAccountId[] {
  return Array.from(new Set(ids));
}

function otherAccountIds(ids: CalendarAccountId[]): CalendarAccountId[] {
  return (['primary', 'secondary'] as const).filter(id => !ids.includes(id));
}

function successfulFetches(results: CalendarEventsFetchResult[]): SuccessfulCalendarEventsFetch[] {
  return results.filter((accountResult): accountResult is SuccessfulCalendarEventsFetch => !('error' in accountResult.result));
}

function todayEventsFromResults(
  results: CalendarEventsFetchResult[],
  accountMode: CalendarAccountMode,
  now: Date,
): CalendarEvent[] {
  const successes = successfulFetches(results);
  const prefixIds = accountMode === 'allConnected' && successes.length > 1;
  return successes
    .flatMap(({ accountId: eventAccountId, result }) =>
      (result.data.events ?? []).map(event => normalizeAccountEvent(event, eventAccountId, prefixIds)),
    )
    .filter(event => calendarEventOverlapsLocalDay(event, now));
}

export function useCalendarEvents(options: UseCalendarEventsOptions = {}): CalendarState {
  const accountMode = options.accountMode ?? 'selected';
  const respectSavedFilters = options.respectSavedFilters ?? true;
  const [initialCalendarState] = useState(readInitialCalendarState);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<CalendarError | null>(null);
  const requestSeqRef = useRef(0);
  const lastFetchedDayRef = useRef<string | null>(null);
  const hasLoadedRef = useRef(false);
  const [needsSelectionMigration, setNeedsSelectionMigration] = useState(initialCalendarState.needsSelectionMigration);

  const [accountId, setAccountIdState] = useState<CalendarAccountId>(initialCalendarState.accountId);
  const [mainCalendarId, setMainCalendarId] = useState<string | null>(initialCalendarState.mainCalendarId);
  const [includedCalendarIds, setIncludedCalendarIds] = useState<string[] | null>(initialCalendarState.includedCalendarIds);
  const filtersActive = mainCalendarId != null || (includedCalendarIds?.length ?? 0) > 0;

  const setAccountId = useCallback((id: CalendarAccountId) => {
    setAccountIdState(id);
    const filters = readCalendarFilters(id);
    setMainCalendarId(filters.mainCalendarId);
    setIncludedCalendarIds(filters.includedCalendarIds);
  }, []);

  useEffect(() => {
    if (!needsSelectionMigration) return;
    migrateCalendarSelectionStorage();
    setNeedsSelectionMigration(false);
  }, [needsSelectionMigration]);

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.calendarAccount, accountId); }, [accountId]);
  useEffect(() => {
    if (mainCalendarId) localStorage.setItem(mainIdKey(accountId), mainCalendarId);
    else localStorage.removeItem(mainIdKey(accountId));
  }, [mainCalendarId, accountId]);
  useEffect(() => {
    if (includedCalendarIds && includedCalendarIds.length) localStorage.setItem(includedIdsKey(accountId), JSON.stringify(includedCalendarIds));
    else localStorage.removeItem(includedIdsKey(accountId));
  }, [includedCalendarIds, accountId]);

  const calendarAccountFetchPlan = useCallback(async (): Promise<CalendarAccountFetchPlan> => {
    if (accountMode === 'selected') return { required: [accountId], optional: [] };
    const result = await apiFetchJson<GoogleAccountsResponse>('/api/auth/google/accounts', { timeoutMs: 5_000 });
    if ('error' in result) {
      return { required: [accountId], optional: otherAccountIds([accountId]) };
    }
    const connected = (result.data.accounts ?? [])
      .filter(account => account.connected)
      .map(account => account.accountId)
      .filter((id): id is CalendarAccountId => id === 'primary' || id === 'secondary');
    const required = connected.length ? uniqueAccountIds(connected) : [accountId];
    return {
      required,
      optional: otherAccountIds(required),
    };
  }, [accountId, accountMode]);

  const refetch = useCallback(async (reason: CalendarFetchReason = 'manual') => {
    const requestId = ++requestSeqRef.current;
    const requestNow = new Date();
    const requestDayStamp = localCalendarDayStamp(requestNow);
    const isStale = () => requestId !== requestSeqRef.current;
    const showBlockingLoader = !hasLoadedRef.current || reason === 'initial';
    if (showBlockingLoader) setIsLoading(true);
    else setIsRefreshing(true);
    setError(null);
    try {
      const fetchPlan = await calendarAccountFetchPlan();
      const fetchAccountEvents = async (fetchAccountId: CalendarAccountId, required: boolean): Promise<CalendarEventsFetchResult> => {
        const opts = {
          accountId: fetchAccountId,
          forceRefresh: reason === 'manual',
          calendarIds: respectSavedFilters && fetchAccountId === accountId
            ? includedCalendarIds ?? (mainCalendarId ? [mainCalendarId] : undefined)
            : undefined,
        };
        const result = await apiFetchJson<{ events?: CalendarEvent[] }>(calendarEventsUrl(opts, requestNow), { timeoutMs: 15_000 });
        return { accountId: fetchAccountId, required, result };
      };

      let accountResults = await Promise.all(fetchPlan.required.map(fetchAccountId => fetchAccountEvents(fetchAccountId, true)));
      if (isStale()) return;

      if (
        accountMode === 'allConnected' &&
        fetchPlan.optional.length > 0 &&
        todayEventsFromResults(accountResults, accountMode, requestNow).length === 0
      ) {
        const optionalResults = await Promise.all(fetchPlan.optional.map(fetchAccountId => fetchAccountEvents(fetchAccountId, false)));
        if (isStale()) return;
        accountResults = [...accountResults, ...optionalResults];
      }

      lastFetchedDayRef.current = requestDayStamp;

      const successes = successfulFetches(accountResults);

      const errors = accountResults
        .map(accountResult => ('error' in accountResult.result && accountResult.required ? accountResult.result.error : null))
        .filter((err): err is ApiError => err != null)
        .sort((a, b) => rankCalendarError(a) - rankCalendarError(b));

      if (successes.length > 0) {
        const todays = todayEventsFromResults(accountResults, accountMode, requestNow);
        if (todays.length === 0 && errors.length > 0) {
          const err = errors[0]!;
          markSyncStatus('calendar', 'error', err.error ?? `HTTP ${err.status}`);
          const state = calendarErrorState(err);
          setEvents([]);
          setIsConnected(state.isConnected);
          setError(state.error);
          return;
        }
        setEvents(todays);
        setIsConnected(true);
        markSyncStatus('calendar', 'ok');
      } else {
        const err = errors[0] ?? { status: 500, error: 'Unknown calendar error' };
        markSyncStatus('calendar', 'error', err.error ?? `HTTP ${err.status}`);
        const state = calendarErrorState(err);
        setIsConnected(state.isConnected);
        setError(state.error);
      }
    } catch {
      if (isStale()) return;
      lastFetchedDayRef.current = requestDayStamp;
      setIsConnected(false);
      setError('network_error');
      markSyncStatus('calendar', 'error', 'Network error');
    } finally {
      if (!isStale()) {
        hasLoadedRef.current = true;
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [accountId, accountMode, calendarAccountFetchPlan, includedCalendarIds, mainCalendarId, respectSavedFilters]);

  useEffect(() => {
    hasLoadedRef.current = false;
    void refetch('initial');
  }, [refetch]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const intervalId = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void refetch('background');
    }, CALENDAR_VISIBLE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [refetch]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let timeoutId: number | undefined;

    const scheduleNextRollover = () => {
      timeoutId = window.setTimeout(() => {
        void refetch('background');
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
      if (fetchedDay && fetchedDay !== localCalendarDayStamp()) void refetch('background');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [refetch]);

  return {
    events,
    isLoading,
    isRefreshing,
    isConnected,
    error,
    mode: 'today',
    accountId,
    mainCalendarId,
    includedCalendarIds,
    filtersActive,
    setAccountId,
    setMainCalendarId,
    setIncludedCalendarIds,
    refetch,
  };
}

export const __testOnly = {
  CALENDAR_SELECTION_VERSION,
  calendarDayInTimeZone,
  localCalendarDayStamp,
  msUntilNextLocalDay,
};
