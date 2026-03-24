import { useState, useEffect, useCallback } from 'react';
import { CalendarEvent } from '../types/calendar';

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
      const res = await fetch('/api/calendar/events');
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
        setIsConnected(true);
      } else if (res.status === 401) {
        setIsConnected(false);
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
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { refetch(); }, [refetch]);

  return { events, isLoading, isConnected, error, refetch };
}
