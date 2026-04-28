import { useCallback, memo, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { useWeatherForecast } from '../../hooks/useWeatherForecast';
import { csrfHeaders } from '../../lib/csrf';
import type { SetViewFn } from '../../config/navigation';
import type { CalendarEvent } from '../../types/calendar';

/** Material Symbols ligature name for WMO weather_code (stable icon names only). */
function weatherMaterialIconName(code: number | null): string {
  if (code === null) return 'wb_cloudy';
  if (code === 0) return 'wb_sunny';
  if (code <= 3) return 'partly_cloudy_day';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 67) return 'rainy';
  if (code >= 71 && code <= 86) return 'snowing';
  if (code >= 95) return 'thunderstorm';
  return 'wb_cloudy';
}

const WeatherGlyph = memo(function WeatherGlyph({ code }: { code: number | null }) {
  const name = weatherMaterialIconName(code);
  return (
    <span
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-[36px] leading-none text-primary material-symbols-outlined"
      aria-hidden="true"
    >
      {name}
    </span>
  );
});

/** GitHub logo — avoids pulling in an extra icon/font dependency. */
function GithubMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.694.825.577C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

type DigestProps = {
  setCurrentView: SetViewFn;
  gmailConnected: boolean;
  gmailServerError: boolean;
  unreadCount: number;
  githubConnected: boolean;
  githubUnreadCount: number;
  discordWebhookConfigured: boolean;
  /** Calendar: show next-up line when connected and snippet exists */
  calendarConnected: boolean;
  nextEventSnippet: string | null;
  /** Raw calendar events forwarded to the AI brief generator */
  calendarEvents: CalendarEvent[];
  /** Tasks remaining (active) */
  remainingTasks: number;
  /** Whether the AI key is configured */
  aiConfigured: boolean;
};

export function DashboardDigestCard({
  setCurrentView,
  gmailConnected,
  gmailServerError,
  unreadCount,
  githubConnected,
  githubUnreadCount,
  discordWebhookConfigured,
  calendarConnected,
  nextEventSnippet,
  calendarEvents,
  remainingTasks,
  aiConfigured,
}: DigestProps) {
  const showGmail = gmailConnected || gmailServerError;
  const showGithub = githubConnected;
  const showDiscord = discordWebhookConfigured;

  const { data, loading, error, refresh } = useWeatherForecast(true);

  /** Show tile while loading, when we have data, or after a failed fetch (compact retry — never blank placeholder). */
  const showWeatherTile = loading || !!data || !!error;

  // AI daily brief
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  const fetchBrief = useCallback(async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const eventsPayload = calendarEvents.slice(0, 20).map(e => ({
        summary: e.summary,
        start: e.start.dateTime ?? e.start.date ?? '',
        end: e.end.dateTime ?? e.end.date ?? '',
      }));
      const res = await fetch('/api/ai/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          calendarEvents: eventsPayload,
          unreadEmailCount: unreadCount,
          activeTaskCount: remainingTasks,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const code = data.code;
        if (code === 'INVALID_KEY' || code === 'NO_AI_KEY' || res.status === 401) {
          setBriefError('key_invalid');
        } else {
          setBriefError(data.error ?? 'Failed to generate brief');
        }
      } else {
        setBrief(data.brief ?? '');
      }
    } catch {
      setBriefError('Network error — check your connection');
    } finally {
      setBriefLoading(false);
    }
  }, [calendarEvents, unreadCount, remainingTasks]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      pos => {
        try {
          localStorage.setItem(
            STORAGE_KEYS.weatherCoords,
            JSON.stringify({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
          );
        } catch { /* quota */ }
        refresh();
      },
      () => { /* denied */ },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 600_000 },
    );
  }, [refresh]);

  const showCalendarRow = calendarConnected && nextEventSnippet != null;
  const showTasksRow = remainingTasks > 0;

  const tileCount =
    Number(showGmail) +
    Number(showGithub) +
    Number(showDiscord) +
    Number(showWeatherTile) +
    Number(showCalendarRow) +
    Number(showTasksRow);

  if (tileCount === 0) return null;

  return (
    <section
      className="glass-panel col-span-full p-5 flex flex-col gap-4 relative overflow-hidden min-h-0"
      aria-label="Dashboard digest"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-sky-400/70 via-primary/40 to-violet-400/40" />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-base text-foreground flex items-center gap-2">
            <span className="material-symbols-outlined h-5 w-5 text-primary shrink-0 text-[20px]" aria-hidden="true">
              rss_feed
            </span>
            At a glance
          </h2>
          <p className="text-[11px] text-text-muted mt-0.5 max-w-xl">
            Quick read on mail, GitHub, Discord, weather, calendar, and tasks. Empty sections stay hidden until you connect services.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {showCalendarRow && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex gap-3 items-start sm:col-span-2 lg:col-span-2">
            <span className="material-symbols-outlined text-primary shrink-0 mt-0.5 text-[22px]" aria-hidden="true">
              calendar_clock
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">Next on calendar</p>
              <p className="text-sm text-foreground leading-snug">{nextEventSnippet}</p>
              <button
                type="button"
                onClick={() => setCurrentView('FocusMode')}
                className="mt-2 text-[11px] font-medium text-primary hover:underline inline-flex items-center gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
              >
                Focus mode
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                  chevron_right
                </span>
              </button>
            </div>
          </div>
        )}

        {showTasksRow && (
          <button
            type="button"
            onClick={() => {
              document.getElementById('main-tasks-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary flex gap-3 items-start"
          >
            <span className="material-symbols-outlined text-emerald-400/90 shrink-0 mt-0.5 text-[22px]" aria-hidden="true">
              task_alt
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">Tasks</p>
              <p className="text-2xl font-heading text-foreground tabular-nums">{remainingTasks}</p>
              <p className="text-xs text-text-muted mt-0.5">Active — scroll to task list</p>
            </div>
          </button>
        )}

        {showGmail && (
          <button
            type="button"
            onClick={() => setCurrentView('Communications')}
            className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary flex gap-3"
          >
            <span className="material-symbols-outlined text-orange-400/90 shrink-0 mt-0.5 text-[22px]" aria-hidden="true">
              mail
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">Gmail</p>
              <p className="text-2xl font-heading text-foreground tabular-nums">{gmailServerError ? '—' : unreadCount}</p>
              <p className="text-xs text-text-muted mt-1">
                {gmailServerError ? 'Server unreachable' : unreadCount === 0 ? 'Inbox zero' : 'Unread'}
              </p>
            </div>
          </button>
        )}

        {showGithub && (
          <button
            type="button"
            onClick={() => setCurrentView('Integrations')}
            className="text-left rounded-xl border border-white/10 bg-white/[0.03] p-4 hover:bg-white/[0.06] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary flex gap-3"
          >
            <GithubMark className="h-5 w-5 shrink-0 mt-0.5 text-text-muted" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">GitHub</p>
              <p className="text-2xl font-heading text-foreground tabular-nums">{githubUnreadCount}</p>
              <p className="text-xs text-text-muted mt-1">{githubUnreadCount === 0 ? 'All clear' : 'Notifications'}</p>
            </div>
          </button>
        )}

        {showDiscord && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex gap-3">
            <span className="material-symbols-outlined text-indigo-400/90 shrink-0 mt-0.5 text-[22px]" aria-hidden="true">
              chat_bubble
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">Discord</p>
              <p className="text-lg font-heading text-foreground">Webhook ready</p>
              <p className="text-xs text-text-muted mt-1">Outgoing alerts enabled</p>
            </div>
          </div>
        )}

        {showWeatherTile && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 flex flex-row items-center gap-3 min-h-[88px]">
            {loading && !data ? (
              <div className="flex items-center gap-3 w-full justify-center py-1 text-text-muted text-sm">
                <span className="material-symbols-outlined animate-spin shrink-0 text-[22px]" aria-hidden="true">
                  progress_activity
                </span>
                Loading weather…
              </div>
            ) : data ? (
              <>
                <WeatherGlyph code={data.weatherCode} />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">Weather</p>
                  <p className="text-2xl font-heading text-foreground tabular-nums">{Math.round(data.temperatureC)}°</p>
                  <p className="text-xs text-text-muted flex items-center gap-1.5 flex-wrap">
                    <span>Feels {Math.round(data.apparentC)}°</span>
                    {data.humidity != null && (
                      <>
                        <span className="opacity-40">·</span>
                        <span className="material-symbols-outlined inline-block text-[14px] shrink-0 opacity-70 align-middle" aria-hidden="true">
                          water_drop
                        </span>
                        <span>{Math.round(data.humidity)}%</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => refresh()}
                    className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-white/5 transition-colors"
                    aria-label="Refresh weather"
                    title="Refresh"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                      refresh
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className="text-[10px] font-medium text-primary hover:underline text-right px-1"
                  >
                    My location
                  </button>
                </div>
              </>
            ) : error ? (
              <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex items-start gap-3">
                  <WeatherGlyph code={null} />
                  <div>
                    <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted mb-0.5">Weather</p>
                    <p className="text-sm text-foreground">Couldn&apos;t load forecast</p>
                    <p className="text-xs text-text-muted mt-0.5">Check network or try another location.</p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => refresh()}
                    className="rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-foreground hover:bg-white/[0.1] transition-colors"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={useMyLocation}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    Use GPS
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* AI Daily Brief — only shown when AI is configured */}
      {aiConfigured && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4 flex gap-3 items-start">
          <span className="material-symbols-outlined text-violet-400 shrink-0 mt-0.5 text-[22px]" aria-hidden="true">
            auto_awesome
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-muted">Today&apos;s brief</p>
              <button
                type="button"
                onClick={fetchBrief}
                disabled={briefLoading}
                aria-label="Generate AI daily brief"
                className="flex items-center gap-1 text-[11px] font-medium text-violet-400 hover:text-violet-300 disabled:opacity-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400 rounded"
              >
                <span className={`material-symbols-outlined text-[16px] ${briefLoading ? 'animate-spin' : ''}`} aria-hidden="true">
                  {briefLoading ? 'progress_activity' : brief ? 'refresh' : 'play_circle'}
                </span>
                {brief ? 'Refresh' : 'Generate'}
              </button>
            </div>
            {brief ? (
              <p className="text-sm text-foreground/90 leading-relaxed">{brief}</p>
            ) : briefError ? (
              briefError === 'key_invalid' ? (
                <p className="text-xs text-red-400">
                  OpenAI API key is missing or invalid.{' '}
                  <button
                    type="button"
                    onClick={() => setCurrentView('Settings')}
                    className="underline hover:text-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400 rounded"
                  >
                    Go to Settings
                  </button>{' '}
                  to add or update your key.
                </p>
              ) : (
                <p className="text-xs text-red-400">{briefError}</p>
              )
            ) : (
              <p className="text-xs text-text-muted italic">
                Click Generate for a 2–3 sentence AI summary of your day.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
