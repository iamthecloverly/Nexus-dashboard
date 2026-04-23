import { useState, useEffect, useCallback } from 'react';
import { CalendarEvent } from '../types/calendar';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';

interface CalendarState {
  events: CalendarEvent[];
  isLoading: boolean;
  isConnected: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCalendarEvents(): CalendarState {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithTimeout('/api/calendar/events', { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
        setIsConnected(true);
      } else if (res.status === 401) {
        const data = await res.json().catch(() => ({} as any));
        const msg = String((data as any)?.error ?? '');
        setIsConnected(false);
        if (msg.toLowerCase().includes('login required')) setError('login_required');
        else setError('not_connected');
      } else if (res.status === 403) {
        const data = await res.json().catch(() => ({} as any));
        const msg = String((data as any)?.error ?? '');
        setIsConnected(false);
        if (msg.toLowerCase().includes('not allowed')) setError('not_allowlisted');
        else if (msg.toLowerCase().includes('not connected')) setError('google_profile_missing');
        else setError('forbidden');
      } else if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        setIsConnected(true);
        setError(data.code === 'API_DISABLED' ? 'api_disabled' : 'fetch_error');
      } else {
        setIsConnected(true);
        setError('fetch_error');
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
