import { describe, expect, it } from 'vitest';

import { __testOnly, formatEmailTime } from '../emailTime';

describe('formatEmailTime', () => {
  it('formats same-day timestamps with a browser-local time', () => {
    const receivedAt = '2026-05-01T21:19:00.000Z';
    const now = new Date('2026-05-01T22:00:00.000Z');
    const expected = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(receivedAt));

    expect(formatEmailTime(receivedAt, '', now)).toBe(expected);
  });

  it('formats older timestamps as dates', () => {
    const receivedAt = '2026-04-30T21:19:00.000Z';
    const now = new Date('2026-05-01T22:00:00.000Z');
    const expected = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(new Date(receivedAt));

    expect(formatEmailTime(receivedAt, '', now)).toBe(expected);
  });

  it('falls back when the server timestamp is missing or invalid', () => {
    expect(formatEmailTime(null, 'May 1')).toBe('May 1');
    expect(formatEmailTime('not-a-date', 'May 1')).toBe('May 1');
  });

  it('compares local calendar days', () => {
    expect(__testOnly.isSameLocalDay(new Date(2026, 4, 1, 9), new Date(2026, 4, 1, 20))).toBe(true);
    expect(__testOnly.isSameLocalDay(new Date(2026, 4, 1, 23), new Date(2026, 4, 2, 1))).toBe(false);
  });
});
