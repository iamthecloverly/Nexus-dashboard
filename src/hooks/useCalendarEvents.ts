import { useState, useEffect, useCallback } from 'react';
import { CalendarEvent } from '../types/calendar';
import { apiFetchJson } from '../lib/apiFetch';

export type CalendarError =
  | 'login_required'
  | 'not_connected'
  | 'not_allowlisted'
  | 'google_profile_missing'
  | 'forbidden'
  | 'api_disabled'
  | 'fetch_error'
  | 'network_error';

interface CalendarState {
  events: CalendarEvent[];
  isLoading: boolean;
  isConnected: boolean;
  error: CalendarError | null;
  refetch: () => void;
}

export function useCalendarEvents(): CalendarState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<CalendarError | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetchJson<{ events?: CalendarEvent[] }>('/api/calendar/events', { timeoutMs: 15_000 });
      if ('error' in result) {
        const err = result.error;
        if (err.status === 401) {
          const code = err.code ?? '';
          const msg = err.error ?? '';
          setIsConnected(false);
          if (code === 'LOGIN_REQUIRED' || msg.toLowerCase().includes('login required')) setError('login_required');
          else setError('not_connected');
        } else if (err.status === 403) {
          const code = err.code ?? '';
          const msg = err.error ?? '';
          setIsConnected(false);
          if (code === 'GOOGLE_NOT_ALLOWLISTED' || msg.toLowerCase().includes('not allowed')) setError('not_allowlisted');
          else if (code === 'GOOGLE_PROFILE_MISSING' || msg.toLowerCase().includes('not connected')) setError('google_profile_missing');
          else setError('forbidden');
        } else if (err.status === 503) {
          setIsConnected(true);
          setError(err.code === 'API_DISABLED' ? 'api_disabled' : 'fetch_error');
        } else {
          setIsConnected(true);
          setError('fetch_error');
        }
      } else {
        setEvents(result.data.events ?? []);
        setIsConnected(true);
      }
    } catch {
      setIsConnected(false);
      setError('network_error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { events, isLoading, isConnected, error, refetch };
}
