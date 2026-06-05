import { describe, expect, it } from 'vitest';

import { __testOnly } from '../MainHub';
import type { Task } from '../../types/task';
import type { CalendarDisplayItem } from '../../lib/calendarDisplay';

const { determinePrimaryNextAction, hasAnyAttention } = __testOnly;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Finish launch checklist',
    completed: false,
    group: 'now',
    ...overrides,
  };
}

function calendarItem(overrides: Partial<CalendarDisplayItem> = {}): CalendarDisplayItem {
  const start = new Date('2026-06-05T14:00:00');
  return {
    event: {
      id: 'event-1',
      summary: 'Planning review',
      start: { dateTime: '2026-06-05T14:00:00' },
      end: { dateTime: '2026-06-05T14:30:00' },
    },
    title: 'Planning review',
    start,
    end: new Date('2026-06-05T14:30:00'),
    sortMs: start.getTime(),
    state: 'upcoming',
    ...overrides,
  } as CalendarDisplayItem;
}

describe('MainHub decision helpers', () => {
  it('prioritizes pending AI suggestions over tasks, calendar, and email', () => {
    const action = determinePrimaryNextAction({
      pendingAiSuggestionCount: 3,
      tasks: [task({ priority: 'Critical' })],
      calendarItems: [calendarItem({ state: 'current' })],
      followUpCount: 2,
      unreadCount: 5,
      firstFollowUpSender: 'Alex',
      now: new Date('2026-06-05T12:00:00'),
    });

    expect(action.kind).toBe('ai');
    expect(action.title).toContain('3 AI suggestions');
  });

  it('uses critical or overdue tasks before calendar and email', () => {
    const action = determinePrimaryNextAction({
      pendingAiSuggestionCount: 0,
      tasks: [task({ priority: 'Critical' })],
      calendarItems: [calendarItem({ state: 'upcoming' })],
      followUpCount: 1,
      unreadCount: 1,
      now: new Date('2026-06-05T12:00:00'),
    });

    expect(action.kind).toBe('task');
    expect(action.label).toBe('Critical Task');
  });

  it('falls back to all clear when no attention sources are active', () => {
    const action = determinePrimaryNextAction({
      pendingAiSuggestionCount: 0,
      tasks: [],
      calendarItems: [],
      followUpCount: 0,
      unreadCount: 0,
      now: new Date('2026-06-05T12:00:00'),
    });

    expect(action.kind).toBe('clear');
  });

  it('reports attention only when at least one status count is active', () => {
    expect(hasAnyAttention({
      pendingAiSuggestionCount: 0,
      remainingTasks: 0,
      unreadCount: 0,
      followUpCount: 0,
      conflictCount: 0,
      deferredCount: 0,
    })).toBe(false);

    expect(hasAnyAttention({
      pendingAiSuggestionCount: 0,
      remainingTasks: 0,
      unreadCount: 0,
      followUpCount: 0,
      conflictCount: 1,
      deferredCount: 0,
    })).toBe(true);
  });
});
