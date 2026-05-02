import { useEffect, useRef } from 'react';
import { parseISO, differenceInSeconds } from 'date-fns';
import type { CalendarEvent } from '../types/calendar';
import { addNotificationLog } from '../lib/dashboardFeatures';

const NOTIFY_BEFORE_SECONDS = 5 * 60;

/**
 * Watches `events` and fires a Notification API alert 5 minutes before each
 * upcoming event.
 *
 * `firedRef` persists across re-renders and remounts within the session so
 * switching tabs and returning never produces duplicate notifications.
 * `timeoutIds` maps event.id → pending timeout so rescheduling on event-list
 * refresh cancels the old timer before setting a new one.
 */
export function useCalendarNotifications(events: CalendarEvent[], enabled = true) {
  const firedRef = useRef<Set<string>>(new Set());
  const timeoutIds = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const ids = timeoutIds.current;

    if (!enabled || !('Notification' in window)) {
      ids.forEach(id => window.clearTimeout(id));
      ids.clear();
      return;
    }

    if (Notification.permission === 'default' && events.length > 0) {
      void Notification.requestPermission();
    }

    const now = Date.now();
    const fired = firedRef.current;

    // Cancel timeouts for events that have been removed from the list.
    const liveIds = new Set(events.map(e => e.id));
    for (const [eventId, timeoutId] of ids) {
      if (!liveIds.has(eventId)) {
        window.clearTimeout(timeoutId);
        ids.delete(eventId);
      }
    }

    events.forEach(event => {
      if (!event.start.dateTime) return;
      if (fired.has(event.id)) return;

      const startMs = parseISO(event.start.dateTime).getTime();
      const notifyAt = startMs - NOTIFY_BEFORE_SECONDS * 1000;
      const delayMs = notifyAt - now;

      if (delayMs < 0 || delayMs > 24 * 60 * 60 * 1000) return;

      // Cancel any existing timeout for this event before rescheduling.
      const existing = ids.get(event.id);
      if (existing !== undefined) window.clearTimeout(existing);

      const timeoutId = window.setTimeout(() => {
        ids.delete(event.id);
        fired.add(event.id);

        if (Notification.permission !== 'granted') return;

        const minutesBefore = Math.round(
          differenceInSeconds(parseISO(event.start.dateTime!), new Date()) / 60,
        );
        const body = minutesBefore > 0
          ? `Starting in ${minutesBefore} minute${minutesBefore !== 1 ? 's' : ''}`
          : 'Starting now';
        addNotificationLog({ type: 'calendar', title: event.summary ?? 'Calendar Event', body });

        try {
          const n = new Notification(event.summary ?? 'Calendar Event', {
            body,
            icon: '/favicon.ico',
            tag: `cal-${event.id}`,
            requireInteraction: false,
          });
          setTimeout(() => n.close(), 8000);
        } catch {
          // Notification constructor can throw in some environments
        }
      }, delayMs);

      ids.set(event.id, timeoutId);
    });

    return () => {
      // Cancel pending timeouts on cleanup; firedRef is intentionally kept so
      // remounts (tab switch) don't re-notify already-fired events.
      ids.forEach(id => window.clearTimeout(id));
      ids.clear();
    };
  }, [events, enabled]);
}
