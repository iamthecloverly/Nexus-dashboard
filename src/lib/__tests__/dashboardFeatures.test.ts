import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildTodayTimeline,
  findCalendarConflicts,
  findFollowUpEmails,
  isTaskDeferred,
  isTaskVisibleToday,
  readDashboardPanelVisibility,
  tomorrowKey,
  writeDashboardPanelVisibility,
} from '../dashboardFeatures';
import { splitCalendarEvents } from '../calendarDisplay';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import type { CalendarEvent } from '../../types/calendar';
import type { Email } from '../../types/email';
import type { Task } from '../../types/task';

const now = new Date('2026-05-01T15:00:00');

function event(id: string, start: string, end: string): CalendarEvent {
  return {
    id,
    summary: id,
    start: { dateTime: start },
    end: { dateTime: end },
    htmlLink: `https://calendar.test/${id}`,
  };
}

function email(overrides: Partial<Email> = {}): Email {
  return {
    accountId: 'primary',
    id: 'email-1',
    sender: 'Ava',
    senderEmail: 'ava@example.com',
    initials: 'A',
    receivedAt: '2026-05-01T12:00:00',
    time: '12:00',
    subject: 'Reminder: please reply',
    preview: 'Can you respond today?',
    unread: true,
    urgent: false,
    archived: false,
    deleted: false,
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Ship dashboard',
    completed: false,
    group: 'now',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('dashboard feature helpers', () => {
  it('persists dashboard panel visibility over defaults', () => {
    writeDashboardPanelVisibility({ ...readDashboardPanelVisibility(), github: false });

    expect(readDashboardPanelVisibility().github).toBe(false);
    expect(readDashboardPanelVisibility().schedule).toBe(false);
    expect(readDashboardPanelVisibility().digest).toBe(true);
    expect(readDashboardPanelVisibility().todayTimeline).toBe(true);
  });

  it('ignores stale saved panel layouts from older dashboard versions', () => {
    localStorage.setItem(STORAGE_KEYS.dashboardPanelVisibility, JSON.stringify({
      digest: true,
      schedule: true,
      github: true,
    }));

    expect(readDashboardPanelVisibility()).toMatchObject({
      digest: true,
      schedule: false,
      github: false,
      todayTimeline: true,
    });
  });

  it('hides deferred tasks until their local day arrives', () => {
    const deferred = task({ deferredUntil: tomorrowKey(now) });

    expect(isTaskDeferred(deferred, now)).toBe(true);
    expect(isTaskVisibleToday(deferred, now)).toBe(false);
  });

  it('detects email follow-ups conservatively', () => {
    expect(findFollowUpEmails([email()], now)).toHaveLength(1);
    expect(findFollowUpEmails([email({ archived: true })], now)).toHaveLength(0);
    expect(findFollowUpEmails([email({ subject: 'Newsletter', preview: 'FYI', unread: false })], now)).toHaveLength(0);
  });

  it('finds overlapping future calendar events', () => {
    const conflicts = findCalendarConflicts([
      event('a', '2026-05-01T16:00:00', '2026-05-01T17:00:00'),
      event('b', '2026-05-01T16:30:00', '2026-05-01T17:30:00'),
      event('c', '2026-05-01T18:00:00', '2026-05-01T18:30:00'),
    ], now);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0][0].event.id).toBe('a');
    expect(conflicts[0][1].event.id).toBe('b');
  });

  it('builds a mixed today timeline from calendar, tasks, and emails', () => {
    const calendarItems = splitCalendarEvents([
      event('standup', '2026-05-01T15:30:00', '2026-05-01T16:00:00'),
    ], now).displayable;

    const timeline = buildTodayTimeline({
      calendarItems,
      tasks: [task({ dueDate: '2026-05-01' })],
      emails: [email()],
      github: [],
      now,
    });

    expect(timeline.map(item => item.kind)).toEqual(expect.arrayContaining(['calendar', 'task', 'email']));
    expect(timeline.length).toBe(3);
  });

  it('uses the documented storage key for panel preferences', () => {
    expect(STORAGE_KEYS.dashboardPanelVisibility).toBe('dashboard_panel_visibility');
  });
});
