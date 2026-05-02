import { useEffect, useRef } from 'react';
import type { Task } from '../types/task';
import { addNotificationLog } from '../lib/dashboardFeatures';

/**
 * Fires a desktop notification for tasks that are due today and not yet
 * completed. Each task is notified at most once per browser session
 * (tracked via `notifiedRef`), so remounts from tab switches don't
 * produce duplicates.
 */
export function useTaskNotifications(tasks: Task[], enabled = true) {
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const today = new Date().toISOString().slice(0, 10);

    tasks.forEach(task => {
      if (task.completed) return;
      if (!task.dueDate || task.dueDate !== today) return;
      if (notifiedRef.current.has(task.id)) return;

      notifiedRef.current.add(task.id);

      try {
        const priorityPrefix = task.priority === 'Critical' ? '🔴 ' : task.priority === 'Priority' ? '🟡 ' : '';
        addNotificationLog({ type: 'task', title: 'Task due today', body: task.title });
        const n = new Notification(`${priorityPrefix}Task due today`, {
          body: task.title,
          icon: '/favicon.ico',
          tag: `task-due-${task.id}`,
          requireInteraction: false,
        });
        setTimeout(() => n.close(), 10_000);
      } catch {
        // Notification constructor can throw in some environments
      }
    });
  }, [tasks, enabled]);
}
