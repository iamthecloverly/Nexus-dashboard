function parseReceivedAt(receivedAt?: string | null): Date | null {
  if (!receivedAt) return null;
  const date = new Date(receivedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatEmailTime(receivedAt?: string | null, fallback = '', now = new Date()): string {
  const date = parseReceivedAt(receivedAt);
  if (!date) return fallback;

  if (isSameLocalDay(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export const __testOnly = {
  isSameLocalDay,
};
