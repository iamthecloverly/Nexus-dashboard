export const YT_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/** Matches YouTube video IDs from all known URL formats */
const YT_URL_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/;

export function extractYouTubeVideoId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  if (YT_VIDEO_ID_RE.test(raw)) return raw;
  const m = raw.match(YT_URL_RE);
  return m?.[1] ?? null;
}

export function formatTimeSeconds(s: number) {
  const safe = Number.isFinite(s) ? Math.max(0, s) : 0;
  const m = Math.floor(safe / 60);
  const sec = Math.floor(safe % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

