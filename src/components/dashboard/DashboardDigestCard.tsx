import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../constants/storageKeys';
import { csrfHeaders } from '../../lib/csrf';
import type { SetViewFn } from '../../config/navigation';
import type { CalendarEvent } from '../../types/calendar';
import { fetchWithTimeout } from '../../lib/fetchWithTimeout';

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
  pendingAiSuggestionCount: number;
  onOpenAiReview: () => void;
  onOpenTasks: () => void;
  onOpenSchedule: () => void;
  allClear: boolean;
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

type BriefErrorKind = 'key_missing' | 'key_invalid' | string;

function briefErrorFromResponse(status: number, data: { code?: unknown; error?: unknown }): BriefErrorKind {
  const code = typeof data.code === 'string' ? data.code : '';
  if (code === 'NO_AI_KEY') return 'key_missing';
  if (code === 'INVALID_KEY') return 'key_invalid';
  if (code === 'LOGIN_REQUIRED') return 'Session expired. Log in again to generate your brief.';
  return typeof data.error === 'string' && data.error.trim()
    ? data.error
    : `Failed to generate brief${status ? ` (HTTP ${status})` : ''}`;
}

type ReadinessTone = 'active' | 'warning' | 'error' | 'clear' | 'quiet';

const READINESS_TONE_CLASS: Record<ReadinessTone, { item: string; icon: string; value: string; cta: string }> = {
  active: {
    item: 'border-primary/[0.28] bg-primary/[0.07] hover:border-primary/40 hover:bg-primary/[0.105]',
    icon: 'bg-primary/[0.14] text-primary',
    value: 'text-primary',
    cta: 'text-primary',
  },
  warning: {
    item: 'border-amber-300/[0.24] bg-amber-300/[0.065] hover:border-amber-300/[0.36] hover:bg-amber-300/[0.095]',
    icon: 'bg-amber-300/[0.13] text-amber-200',
    value: 'text-amber-200',
    cta: 'text-amber-200',
  },
  error: {
    item: 'border-rose-300/[0.24] bg-rose-300/[0.065] hover:border-rose-300/[0.36] hover:bg-rose-300/[0.095]',
    icon: 'bg-rose-300/[0.13] text-rose-200',
    value: 'text-rose-200',
    cta: 'text-rose-200',
  },
  clear: {
    item: 'border-emerald-300/[0.16] bg-emerald-300/[0.04] hover:border-emerald-300/[0.24] hover:bg-emerald-300/[0.06]',
    icon: 'bg-emerald-300/10 text-emerald-200',
    value: 'text-emerald-200',
    cta: 'text-emerald-200',
  },
  quiet: {
    item: 'border-white/10 bg-white/[0.022] hover:border-white/[0.14] hover:bg-white/[0.045]',
    icon: 'bg-white/[0.055] text-text-muted',
    value: 'text-foreground',
    cta: 'text-primary',
  },
};

export function DashboardDigestCard({
  setCurrentView,
  pendingAiSuggestionCount,
  onOpenAiReview,
  onOpenTasks,
  onOpenSchedule,
  allClear,
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
  const showGithub = githubConnected;
  const showDiscord = discordWebhookConfigured;
  const showCalendarRow = calendarConnected && nextEventSnippet != null;
  const showTasksRow = remainingTasks > 0;
  const showDigestMeta = aiConfigured || showGithub || showDiscord;
  const readinessSignalCount = [
    pendingAiSuggestionCount > 0,
    remainingTasks > 0,
    gmailServerError || !gmailConnected || unreadCount > 0,
    !calendarConnected,
    githubUnreadCount > 0,
  ].filter(Boolean).length;
  const readinessItems = [
    {
      id: 'ai',
      icon: 'auto_awesome',
      label: 'AI Review',
      value: pendingAiSuggestionCount > 0 ? `${pendingAiSuggestionCount} pending` : 'Clear',
      detail: pendingAiSuggestionCount > 0 ? 'Review before adding tasks.' : 'No extracted tasks waiting.',
      tone: pendingAiSuggestionCount > 0 ? 'active' : 'quiet',
      cta: pendingAiSuggestionCount > 0 ? 'Review' : '',
      onClick: pendingAiSuggestionCount > 0 ? onOpenAiReview : undefined,
    },
    {
      id: 'tasks',
      icon: 'task_alt',
      label: 'Tasks',
      value: showTasksRow ? `${remainingTasks} active` : 'Clear',
      detail: showTasksRow ? 'Open the active list.' : 'No active tasks right now.',
      tone: showTasksRow ? 'warning' : 'clear',
      cta: showTasksRow ? 'Open' : 'Add',
      onClick: onOpenTasks,
    },
    {
      id: 'gmail',
      icon: gmailServerError ? 'error' : 'mark_email_unread',
      label: 'Gmail',
      value: gmailServerError ? 'Server issue' : gmailConnected ? (unreadCount > 0 ? `${unreadCount} unread` : 'Clear') : 'Connect',
      detail: gmailServerError ? 'Open Communications to retry.' : gmailConnected ? 'Inbox triage status.' : 'Connect Gmail for inbox triage.',
      tone: gmailServerError ? 'error' : unreadCount > 0 || !gmailConnected ? 'warning' : 'clear',
      cta: gmailServerError ? 'Retry' : unreadCount > 0 ? 'Triage' : !gmailConnected ? 'Connect' : 'Open',
      onClick: () => setCurrentView(gmailConnected || gmailServerError ? 'Communications' : 'Integrations'),
    },
    {
      id: 'calendar',
      icon: calendarConnected ? 'event_available' : 'event_busy',
      label: 'Calendar',
      value: showCalendarRow ? 'Next up' : calendarConnected ? 'Clear' : 'Connect',
      detail: showCalendarRow ? nextEventSnippet : calendarConnected ? 'No schedule pressure.' : 'Connect Google Calendar.',
      tone: !calendarConnected ? 'warning' : showCalendarRow ? 'active' : 'clear',
      cta: calendarConnected ? 'View' : 'Connect',
      onClick: calendarConnected ? onOpenSchedule : () => setCurrentView('Integrations'),
    },
  ] as const;

  // AI daily brief — cached in localStorage per-day so tab switches don't waste tokens.
  const [brief, setBrief] = useState<string | null>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.dailyBrief);
      if (!stored) return null;
      const { date, text } = JSON.parse(stored) as { date: string; text: string };
      return date === new Date().toISOString().slice(0, 10) ? text : null;
    } catch { return null; }
  });
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
      const res = await fetchWithTimeout('/api/ai/daily-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({
          calendarEvents: eventsPayload,
          unreadEmailCount: unreadCount,
          activeTaskCount: remainingTasks,
        }),
        timeoutMs: 20_000,
      });
      const data = await res.json();
      if (!res.ok) {
        setBriefError(briefErrorFromResponse(res.status, data));
      } else {
        const text = data.brief ?? '';
        setBrief(text);
        try {
          localStorage.setItem(
            STORAGE_KEYS.dailyBrief,
            JSON.stringify({ date: new Date().toISOString().slice(0, 10), text }),
          );
        } catch { /* storage quota */ }
      }
    } catch {
      setBriefError('Network error — check your connection');
    } finally {
      setBriefLoading(false);
    }
  }, [calendarEvents, unreadCount, remainingTasks]);

  useEffect(() => {
    const handler = () => { void fetchBrief(); };
    window.addEventListener('dashboard:generate-brief', handler);
    return () => window.removeEventListener('dashboard:generate-brief', handler);
  }, [fetchBrief]);

  const renderBrief = () => {
    if (!aiConfigured) return null;

    return (
      <div className="flex min-w-0 items-start gap-3 rounded-lg border border-white/10 bg-white/[0.022] px-3 py-2.5">
        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[19px] text-primary/80" aria-hidden="true">
          auto_awesome
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/95">Today&apos;s brief</p>
            <button
              type="button"
              onClick={fetchBrief}
              disabled={briefLoading}
              aria-label="Generate AI daily brief"
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded text-[11px] font-medium text-primary transition-colors hover:text-primary/80 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className={`material-symbols-outlined !text-[15px] ${briefLoading ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true">
                {briefLoading ? 'progress_activity' : brief ? 'refresh' : 'play_circle'}
              </span>
              {brief ? 'Refresh' : 'Generate'}
            </button>
          </div>
          {brief ? (
            <p className="mt-1 max-w-[75ch] text-sm leading-relaxed text-foreground/90">
              {brief}
            </p>
          ) : briefError ? (
            briefError === 'key_missing' || briefError === 'key_invalid' ? (
              <p className="mt-1 text-xs text-red-300">
                OpenAI key issue.{' '}
                <button
                  type="button"
                  onClick={() => setCurrentView('Settings')}
                  className="rounded underline underline-offset-2 hover:text-red-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-300"
                >
                  Settings
                </button>
              </p>
            ) : (
              <p className="mt-1 truncate text-xs text-red-300">{briefError}</p>
            )
          ) : (
            <p className="mt-1 text-xs text-text-muted">Generate when you want a quick read.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <section
      className="glass-panel col-span-full relative flex min-h-0 flex-col gap-3 overflow-hidden p-3.5 md:p-4"
      aria-label="Dashboard digest"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-primary/45 via-primary/12 to-transparent" />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(220px,0.58fr)_minmax(0,1.42fr)] xl:items-stretch">
        <div className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-3 ${
          allClear
            ? 'border-emerald-300/18 bg-emerald-300/[0.04]'
            : 'border-white/10 bg-white/[0.025]'
        }`}>
          <span className={`material-symbols-outlined flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[21px] ${
            allClear ? 'bg-emerald-300/10 text-emerald-200' : 'bg-primary/12 text-primary'
          }`} aria-hidden="true">
            {allClear ? 'verified' : 'radar'}
          </span>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/95">Today&apos;s Readiness</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                allClear ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200' : 'border-amber-300/24 bg-amber-300/10 text-amber-200'
              }`}>
                {allClear ? 'Clear' : `${readinessSignalCount} signal${readinessSignalCount === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {allClear ? 'Ready enough to focus' : 'Work cues are grouped by urgency'}
            </p>
            <p className="mt-0.5 truncate text-xs text-text-muted">
              {allClear ? 'Tasks, inbox, AI, and schedule look quiet.' : 'Clear items stay muted so active ones stand out.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {readinessItems.map(item => {
            const tone = READINESS_TONE_CLASS[item.tone];
            const body = (
              <>
                <span className={`material-symbols-outlined flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[20px] ${tone.icon}`} aria-hidden="true">
                  {item.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-mono uppercase tracking-[0.18em] text-text-muted/95">{item.label}</span>
                  <span className={`mt-0.5 block truncate text-sm font-semibold ${tone.value}`}>
                    {item.value}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-text-muted">{item.detail}</span>
                </span>
                {item.cta && (
                  <span className={`shrink-0 text-[11px] font-semibold ${tone.cta}`}>
                    {item.cta}
                  </span>
                )}
              </>
            );

            if (!item.onClick) {
              return (
                <div key={item.id} className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 ${tone.item}`}>
                  {body}
                </div>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                onClick={item.onClick}
                className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${tone.item}`}
              >
                {body}
              </button>
            );
          })}
        </div>
      </div>

      {showDigestMeta && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_auto] xl:items-center">
          {renderBrief()}
          {(showGithub || showDiscord) && (
            <div className="flex flex-wrap gap-2">
              {showGithub && (
                <button
                  type="button"
                  onClick={() => setCurrentView('Integrations')}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-xs text-text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <GithubMark className="h-3.5 w-3.5" />
                  GitHub {githubUnreadCount}
                </button>
              )}
              {showDiscord && (
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-xs text-text-muted">
                  <span className="material-symbols-outlined !text-[14px]" aria-hidden="true">chat_bubble</span>
                  Discord ready
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export const __testOnly = { briefErrorFromResponse };
