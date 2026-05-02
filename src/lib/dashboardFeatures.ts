import { format, isSameDay, isValid, parseISO, startOfDay, addDays } from 'date-fns';

import { STORAGE_KEYS } from '../constants/storageKeys';
import type { CalendarEvent } from '../types/calendar';
import type { Email } from '../types/email';
import type { Task } from '../types/task';
import { getCalendarEventDisplayItem, type CalendarDisplayItem } from './calendarDisplay';

export type DashboardPanelId =
  | 'digest'
  | 'todayTimeline'
  | 'alerts'
  | 'schedule'
  | 'system'
  | 'tasks'
  | 'triage'
  | 'github';

export const DEFAULT_DASHBOARD_PANEL_VISIBILITY: Record<DashboardPanelId, boolean> = {
  digest: true,
  todayTimeline: true,
  alerts: true,
  schedule: false,
  system: true,
  tasks: true,
  triage: true,
  github: false,
};

const DASHBOARD_PANEL_LAYOUT_VERSION = 3;
type StoredDashboardPanelVisibility = Partial<Record<DashboardPanelId, boolean>> & {
  __layoutVersion?: number;
};

export type SyncService = 'calendar' | 'gmailPrimary' | 'gmailSecondary' | 'system';

export interface SyncRecord {
  status: 'ok' | 'error';
  checkedAt: string;
  message?: string;
}

export type SyncHealth = Partial<Record<SyncService, SyncRecord>>;

export interface NotificationLogEntry {
  id: string;
  type: 'calendar' | 'task' | 'focus' | 'system';
  title: string;
  body?: string;
  createdAt: string;
}

export interface FocusSessionEntry {
  id: string;
  createdAt: string;
  minutes: number;
  note?: string;
  mode: 'focus' | 'break';
}

export interface TodayTimelineItem {
  id: string;
  kind: 'calendar' | 'task' | 'email' | 'github';
  title: string;
  subtitle: string;
  timeLabel: string;
  sortMs: number;
  status: 'now' | 'next' | 'done' | 'attention';
  sourceId?: string;
  calendarItem?: CalendarDisplayItem;
}

export interface GithubTimelineSource {
  id: string;
  title: string;
  repo: string;
  updatedAt: string;
}

export function localDateKey(date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

function parseLocalDate(value?: string): Date | null {
  if (!value) return null;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

function safeReadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeWriteJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota/security failures; UI can continue without persistence.
  }
}

export function readDashboardPanelVisibility(): Record<DashboardPanelId, boolean> {
  const stored = safeReadJson<StoredDashboardPanelVisibility>(
    STORAGE_KEYS.dashboardPanelVisibility,
    {},
  );
  if (stored.__layoutVersion !== DASHBOARD_PANEL_LAYOUT_VERSION) {
    return DEFAULT_DASHBOARD_PANEL_VISIBILITY;
  }
  const panels = { ...stored };
  delete panels.__layoutVersion;
  return { ...DEFAULT_DASHBOARD_PANEL_VISIBILITY, ...panels };
}

export function writeDashboardPanelVisibility(next: Record<DashboardPanelId, boolean>) {
  safeWriteJson(STORAGE_KEYS.dashboardPanelVisibility, {
    __layoutVersion: DASHBOARD_PANEL_LAYOUT_VERSION,
    ...next,
  });
}

export function readSyncHealth(): SyncHealth {
  return safeReadJson<SyncHealth>(STORAGE_KEYS.syncHealth, {});
}

export function markSyncStatus(service: SyncService, status: SyncRecord['status'], message?: string) {
  const next = {
    ...readSyncHealth(),
    [service]: {
      status,
      checkedAt: new Date().toISOString(),
      ...(message ? { message } : {}),
    },
  };
  safeWriteJson(STORAGE_KEYS.syncHealth, next);
}

export function readNotificationLog(): NotificationLogEntry[] {
  const entries = safeReadJson<NotificationLogEntry[]>(STORAGE_KEYS.notificationLog, []);
  return Array.isArray(entries) ? entries.filter(entry => entry && typeof entry.id === 'string').slice(0, 50) : [];
}

export function addNotificationLog(entry: Omit<NotificationLogEntry, 'id' | 'createdAt'>) {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const next: NotificationLogEntry[] = [
    { ...entry, id, createdAt: new Date().toISOString() },
    ...readNotificationLog(),
  ].slice(0, 50);
  safeWriteJson(STORAGE_KEYS.notificationLog, next);
}

export function downloadLocalDashboardData() {
  const values = Object.fromEntries(
    Object.values(STORAGE_KEYS).map(key => [key, localStorage.getItem(key)]),
  );
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), values }, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `nexus-dashboard-${localDateKey()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function isTaskDeferred(task: Task, now = new Date()): boolean {
  const deferred = parseLocalDate(task.deferredUntil);
  if (!deferred) return false;
  return startOfDay(deferred).getTime() > startOfDay(now).getTime();
}

export function tomorrowKey(now = new Date()): string {
  return localDateKey(addDays(now, 1));
}

export function isTaskDueToday(task: Task, now = new Date()): boolean {
  const due = parseLocalDate(task.dueDate);
  return !!due && isSameDay(due, now);
}

export function isTaskVisibleToday(task: Task, now = new Date()): boolean {
  if (task.completed || isTaskDeferred(task, now)) return false;
  return task.group === 'now' || isTaskDueToday(task, now) || task.priority === 'Critical';
}

export function isFollowUpEmail(email: Email, now = new Date()): boolean {
  if (email.archived || email.deleted) return false;
  if (email.urgent && email.unread) return true;

  const text = `${email.subject} ${email.preview}`.toLowerCase();
  const keywordHit = /\b(follow up|reply|respond|reminder|deadline|action required|waiting|urgent)\b/.test(text);
  if (!keywordHit) return false;

  const received = email.receivedAt ? new Date(email.receivedAt) : null;
  const hoursOld = received && Number.isFinite(received.getTime())
    ? (now.getTime() - received.getTime()) / 3_600_000
    : 0;

  return email.unread || hoursOld >= 6;
}

export function findFollowUpEmails(emails: Email[], now = new Date()): Email[] {
  return emails.filter(email => isFollowUpEmail(email, now)).slice(0, 6);
}

export function findCalendarConflicts(events: CalendarEvent[], now = new Date()): Array<[CalendarDisplayItem, CalendarDisplayItem]> {
  const timed = events
    .map(event => getCalendarEventDisplayItem(event, now))
    .filter((item): item is CalendarDisplayItem => !!item && item.state !== 'allDay' && item.state !== 'past' && !!item.end)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const conflicts: Array<[CalendarDisplayItem, CalendarDisplayItem]> = [];
  for (let i = 0; i < timed.length - 1; i += 1) {
    const current = timed[i];
    const next = timed[i + 1];
    if (current.end && current.end.getTime() > next.start.getTime()) conflicts.push([current, next]);
  }
  return conflicts.slice(0, 4);
}

export function buildTaskFromEmail(email: Pick<Email, 'id' | 'subject' | 'sender' | 'preview'>): Task {
  const title = email.subject?.trim() ? `Reply: ${email.subject.trim()}` : `Follow up with ${email.sender}`;
  return {
    id: crypto.randomUUID(),
    title,
    description: email.preview || `Email from ${email.sender}`,
    completed: false,
    group: 'next',
    source: { type: 'email', id: email.id, label: email.sender },
    createdAt: new Date().toISOString(),
    tags: ['email'],
  };
}

export function buildTaskFromCalendar(item: CalendarDisplayItem): Task {
  return {
    id: crypto.randomUUID(),
    title: `Prep: ${item.title}`,
    description: `Calendar event at ${format(item.start, 'HH:mm')}`,
    dueDate: localDateKey(item.start),
    completed: false,
    group: item.state === 'current' ? 'now' : 'next',
    source: { type: 'calendar', id: item.event.id, label: item.title },
    createdAt: new Date().toISOString(),
    tags: ['calendar'],
  };
}

function emailSortMs(email: Email, now: Date): number {
  if (!email.receivedAt) return now.getTime() + 30 * 60_000;
  const date = new Date(email.receivedAt);
  return Number.isFinite(date.getTime()) && isSameDay(date, now)
    ? date.getTime()
    : now.getTime() + 30 * 60_000;
}

export function buildTodayTimeline({
  calendarItems,
  tasks,
  emails,
  github,
  now = new Date(),
}: {
  calendarItems: CalendarDisplayItem[];
  tasks: Task[];
  emails: Email[];
  github: GithubTimelineSource[];
  now?: Date;
}): TodayTimelineItem[] {
  const items: TodayTimelineItem[] = [];

  for (const item of calendarItems) {
    const isDone = item.state === 'past';
    items.push({
      id: `calendar:${item.event.id}`,
      kind: 'calendar',
      title: item.title,
      subtitle: item.state === 'allDay' ? 'Calendar · all day' : 'Calendar',
      timeLabel: item.state === 'allDay' ? 'All day' : format(item.start, 'HH:mm'),
      sortMs: item.state === 'allDay' ? startOfDay(now).getTime() : item.sortMs,
      status: item.state === 'current' ? 'now' : isDone ? 'done' : 'next',
      sourceId: item.event.id,
      calendarItem: item,
    });
  }

  for (const task of tasks.filter(task => isTaskVisibleToday(task, now))) {
    const due = parseLocalDate(task.dueDate);
    items.push({
      id: `task:${task.id}`,
      kind: 'task',
      title: task.title,
      subtitle: task.priority ? `Task · ${task.priority}` : 'Task',
      timeLabel: due ? 'Due today' : task.group === 'now' ? 'Now' : 'Next',
      sortMs: due ? startOfDay(now).getTime() + 8 * 60 * 60_000 : now.getTime() + (task.group === 'now' ? 5 : 45) * 60_000,
      status: task.priority === 'Critical' ? 'attention' : task.group === 'now' ? 'now' : 'next',
      sourceId: task.id,
    });
  }

  for (const email of findFollowUpEmails(emails, now).slice(0, 4)) {
    items.push({
      id: `email:${email.id}`,
      kind: 'email',
      title: email.subject || '(no subject)',
      subtitle: `Email · ${email.sender}`,
      timeLabel: email.time || 'Inbox',
      sortMs: emailSortMs(email, now),
      status: email.urgent ? 'attention' : 'next',
      sourceId: email.id,
    });
  }

  for (const notif of github.slice(0, 3)) {
    const updated = new Date(notif.updatedAt);
    items.push({
      id: `github:${notif.id}`,
      kind: 'github',
      title: notif.title,
      subtitle: `GitHub · ${notif.repo}`,
      timeLabel: Number.isFinite(updated.getTime()) ? format(updated, 'MMM d') : 'GitHub',
      sortMs: Number.isFinite(updated.getTime()) ? updated.getTime() : now.getTime() + 2 * 60 * 60_000,
      status: 'next',
      sourceId: notif.id,
    });
  }

  return items.sort((a, b) => a.sortMs - b.sortMs || a.title.localeCompare(b.title)).slice(0, 12);
}
