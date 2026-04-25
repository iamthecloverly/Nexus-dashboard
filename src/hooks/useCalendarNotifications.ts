import { useEffect, useRef } from 'react';
import { parseISO, differenceInSeconds } from 'date-fns';
import type { CalendarEvent } from '../types/calendar';

/** How many seconds before an event to fire a notification. */
const NOTIFY_BEFORE_SECONDS = 5 * 60; // 5 minutes

/**
 * Watches `events` and fires a Notification API alert 5 minutes before each
 * upcoming event. Requests notification permission the first time it's needed.
 *
 * Tracked event IDs are stored in a ref so the effect re-registers when the
 * event list changes without duplicating already-scheduled notifications.
 */
export function useCalendarNotifications(events: CalendarEvent[], enabled = true) {
  const scheduledRef = useRef<Set<string>>(new Set());
  const timeoutIds = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) return;
    if (!('Notification' in window)) return;

    // Kick off permission request the first time we have events
    if (Notification.permission === 'default' && events.length > 0) {
      void Notification.requestPermission();
    }

    const now = Date.now();

    events.forEach(event => {
      // Only handle timed (not all-day) events
      if (!event.start.dateTime) return;
      // Avoid scheduling the same event twice
      if (scheduledRef.current.has(event.id)) return;

      const startMs = parseISO(event.start.dateTime).getTime();
      const notifyAt = startMs - NOTIFY_BEFORE_SECONDS * 1000;
      const delayMs = notifyAt - now;

      // Only schedule if the notification is still in the future (up to 24 h ahead)
      if (delayMs < 0 || delayMs > 24 * 60 * 60 * 1000) return;

      scheduledRef.current.add(event.id);

      const id = window.setTimeout(() => {
        if (Notification.permission !== 'granted') return;
        const minutesBefore = Math.round(differenceInSeconds(parseISO(event.start.dateTime!), new Date()) / 60);
        const body = minutesBefore > 0
          ? `Starting in ${minutesBefore} minute${minutesBefore !== 1 ? 's' : ''}`
          : 'Starting now';
        try {
          const n = new Notification(event.summary ?? 'Calendar Event', {
            body,
            icon: '/favicon.ico',
            tag: `cal-${event.id}`,
            requireInteraction: false,
          });
          // Auto-close after 8 seconds if the browser doesn't
          setTimeout(() => n.close(), 8000);
        } catch {
          // Notification constructor can throw in some environments
        }
      }, delayMs);

      timeoutIds.current.push(id);
    });

    return () => {
      // Clear pending timeouts on unmount or when deps change
      timeoutIds.current.forEach(id => window.clearTimeout(id));
      timeoutIds.current = [];
      scheduledRef.current.clear();
    };
  }, [events, enabled]);
}
