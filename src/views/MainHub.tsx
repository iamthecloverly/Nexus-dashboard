import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { parseISO, isBefore, isAfter, differenceInMinutes, startOfDay, differenceInCalendarDays, format } from 'date-fns';

import { Task, TaskPriority } from '../types/task';
import { useTaskContext } from '../contexts/taskContext';
import { useEmailContext } from '../contexts/emailContext';
import { CalendarEvent } from '../types/calendar';
import { useToast } from '../components/Toast';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarNotifications } from '../hooks/useCalendarNotifications';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { fetchWithTimeout } from '../lib/fetchWithTimeout';
import { useDismissibleLayer } from '../hooks/useDismissibleLayer';
import { usePollingWhenVisible } from '../hooks/usePollingWhenVisible';
import { SystemMetricsTile } from '../components/dashboard/SystemMetricsTile';
import { DashboardDigestCard } from '../components/dashboard/DashboardDigestCard';
import { TagInput } from '../components/TagInput';
import type { SetViewFn } from '../config/navigation';

/**
 * Isolated clock display — owns its own 1s interval so that only this small
 * component re-renders every second instead of the entire MainHub tree.
 */
function ClockDisplay() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = useMemo(() => new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now), [now]);
  const seconds = useMemo(() => new Intl.DateTimeFormat(undefined, {
    second: '2-digit',
    hour12: false,
  }).format(now), [now]);
  const date = useMemo(() => new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: '2-digit',
  }).format(now), [now]);
  return (
    <>
      <h1 className="text-foreground font-heading tracking-tight drop-shadow-lg leading-none" style={{ fontSize: 'clamp(3rem,6vw,4.5rem)' }}>
        {time}
        <span className="text-primary/40 ml-1 text-[40%]">{seconds}</span>
      </h1>
      <p className="text-text-muted text-sm font-medium tracking-[0.2em] uppercase">{date}</p>
    </>
  );
}

interface GithubNotification {
  id: string;
  title: string;
  type: string;
  repo: string;
  reason: string;
  updatedAt: string;
  url?: string;
}

function githubTypeIcon(type: string): string {
  if (type === 'PullRequest') return 'merge';
  if (type === 'Issue') return 'bug_report';
  if (type === 'Release') return 'new_releases';
  return 'notifications';
}

/** Priority metadata — defined outside the component to avoid recreating on every render. */
const PRIORITY_STYLES: Record<TaskPriority, { dot: string; badge: string; label: string; checkboxBorder: string; checkboxHover: string }> = {
  Priority: {
    dot: 'bg-yellow-400',
    badge: 'text-yellow-400 bg-yellow-400/10 border-yellow-400/20',
    label: 'Priority',
    checkboxBorder: 'border-yellow-400/50',
    checkboxHover: 'group-hover/task:border-yellow-400',
  },
  Critical: {
    dot: 'bg-red-400',
    badge: 'text-red-400 bg-red-400/10 border-red-400/20',
    label: 'Critical',
    checkboxBorder: 'border-red-400/50',
    checkboxHover: 'group-hover/task:border-red-400',
  },
};

/** Returns true when a task's due date has passed (today midnight) and it is not completed. */
function isOverdue(task: Task, today: Date): boolean {
  if (!task.dueDate || task.completed) return false;
  return isBefore(parseISO(task.dueDate), today);
}

/** Formats a YYYY-MM-DD due date as a short human-readable label. */
function formatDueDate(dueDate: string, today: Date): string {
  const due = parseISO(dueDate);
  const diff = differenceInCalendarDays(due, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (diff <= 7) return `in ${diff}d`;
  return format(due, 'MMM d');
}

interface MainHubProps {
  setCurrentView: SetViewFn;
  /** Increment to open the quick-add FAB from outside (e.g. command palette). */
  externalQuickAddTrigger?: number;
  /** Increment to trigger a calendar refetch from outside (e.g. command palette). */
  externalCalendarRefreshTrigger?: number;
}

export default function MainHub({ setCurrentView, externalQuickAddTrigger, externalCalendarRefreshTrigger }: MainHubProps) {
  const fmtTime = useMemo(() => new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }), []);
  const { state: { tasks }, actions: { toggleTask, addTask, deleteTask, updateTask, clearCompletedTasks } } = useTaskContext();
  const { state: { emails, gmailConnected, serverError: gmailServerError } } = useEmailContext();
  const { showToast } = useToast();
  const [currentTime, setCurrentTime] = useState(new Date());
  const { events, isLoading: isLoadingEvents, isConnected: isCalendarConnected, error: calendarError, refetch: fetchEvents } = useCalendarEvents();

  // Browser notifications: 5 minutes before each calendar event
  useCalendarNotifications(events, isCalendarConnected);

  // Pre-sort events once per fetch (avoids re-sorting on every `currentTime` tick).
  const sortedEvents = useMemo(() => {
    if (!events || events.length === 0) return [];
    return [...events].sort((a, b) => {
      const as = a.start.dateTime ? parseISO(a.start.dateTime) : parseISO(a.start.date ?? '');
      const bs = b.start.dateTime ? parseISO(b.start.dateTime) : parseISO(b.start.date ?? '');
      return as.getTime() - bs.getTime();
    });
  }, [events]);

  // GitHub
  const [githubNotifs, setGithubNotifs] = useState<GithubNotification[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);

  const [discordWebhookConfigured, setDiscordWebhookConfigured] = useState(false);

  // AI configured status (for daily brief)
  const [aiConfigured, setAiConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/status')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d?.configured) setAiConfigured(true); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Onboarding banner
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(STORAGE_KEYS.onboardingDismissed));

  // Calendar context menu & full-screen schedule
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  // Task inline edit
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [showTaskMenu, setShowTaskMenu] = useState(false);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const calendarMenuRef = useRef<HTMLDivElement>(null);

  // FAB quick-add
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddGroup, setQuickAddGroup] = useState<'now' | 'next'>('now');
  const [quickAddPriority, setQuickAddPriority] = useState<TaskPriority | undefined>(undefined);
  const [quickAddDueDate, setQuickAddDueDate] = useState('');
  const [quickAddTags, setQuickAddTags] = useState<string[]>([]);
  const quickAddRef = useRef<HTMLInputElement>(null);

  const { remainingTasks, activeTasks, completedTasks } = useMemo(() => {
    const active: Task[] = [];
    const completed: Task[] = [];
    for (const t of tasks) { (t.completed ? completed : active).push(t); }
    return { remainingTasks: active.length, activeTasks: active, completedTasks: completed };
  }, [tasks]);

  const { unreadEmails, unreadCount, lastUnreadEmail } = useMemo(() => {
    const unread = emails.filter(e => e.unread && !e.archived && !e.deleted);
    return { unreadEmails: unread, unreadCount: unread.length, lastUnreadEmail: unread[0] ?? null };
  }, [emails]);

  /** Next calendar line for digest (upcoming / now / all-day). */
  const digestNextEventSnippet = useMemo(() => {
    if (!isCalendarConnected || calendarError || sortedEvents.length === 0) return null;
    const now = currentTime;
    for (const ev of sortedEvents) {
      const allDay = !ev.start.dateTime;
      const start = ev.start.dateTime ? parseISO(ev.start.dateTime) : parseISO(ev.start.date ?? '');
      const end = ev.end.dateTime ? parseISO(ev.end.dateTime) : parseISO(ev.end.date ?? '');
      if (!isAfter(end, now)) continue;
      const title = ((ev.summary || '').trim()) || 'Busy';
      if (allDay) return `${title} · All day`;
      if (isBefore(start, now) && isAfter(end, now)) return `${title} · Now`;
      if (!isBefore(start, now)) {
        const mins = differenceInMinutes(start, now);
        if (mins >= 0 && mins < 90) return `${title} · in ${mins} min`;
        return `${title} · ${fmtTime.format(start)}`;
      }
    }
    return null;
  }, [sortedEvents, currentTime, isCalendarConnected, calendarError, fmtTime]);

  // currentTime used only for event isCurrent/isPast — 10s is sufficient precision
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // Memoized start-of-today date for overdue checks — only recomputes when currentTime date changes
  const todayStart = useMemo(() => startOfDay(currentTime), [currentTime]);

  // GitHub notifications — poll every 5 minutes
  const fetchGithub = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/github/notifications', { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json();
        setGithubNotifs(data.notifications ?? []);
        setGithubConnected(true);
      } else if (res.status === 401) {
        setGithubConnected(false);
      }
    } catch { setGithubConnected(false); }
  }, []);

  usePollingWhenVisible({
    enabled: true,
    poll: fetchGithub,
    intervalMs: 5 * 60 * 1000,
  });

  const fetchDiscordStatus = useCallback(async () => {
    try {
      const res = await fetchWithTimeout('/api/discord/status', { timeoutMs: 15_000 });
      if (res.ok) {
        const data = await res.json() as { connected?: boolean };
        setDiscordWebhookConfigured(!!data.connected);
      }
    } catch { /* ignore */ }
  }, []);

  usePollingWhenVisible({
    enabled: true,
    poll: fetchDiscordStatus,
    intervalMs: 5 * 60 * 1000,
  });

  // External triggers from command palette
  useEffect(() => {
    if (!externalQuickAddTrigger) return;
    setShowQuickAdd(true);
    setTimeout(() => quickAddRef.current?.focus(), 50);
  }, [externalQuickAddTrigger]);

  useEffect(() => {
    if (!externalCalendarRefreshTrigger) return;
    fetchEvents();
    showToast('Calendar refreshed', 'info');
  }, [externalCalendarRefreshTrigger, fetchEvents, showToast]);

  const handleQuickAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && quickAddTitle.trim()) {
      addTask({
        id: crypto.randomUUID(),
        title: quickAddTitle.trim(),
        completed: false,
        group: quickAddGroup,
        priority: quickAddPriority,
        dueDate: quickAddDueDate || undefined,
        tags: quickAddTags.length > 0 ? quickAddTags : undefined,
      });
      showToast('Task added', 'success');
      setQuickAddTitle('');
      setQuickAddPriority(undefined);
      setQuickAddDueDate('');
      setQuickAddTags([]);
      setShowQuickAdd(false);
    }
    if (e.key === 'Escape') {
      setQuickAddTitle('');
      setQuickAddPriority(undefined);
      setQuickAddDueDate('');
      setQuickAddTags([]);
      setShowQuickAdd(false);
    }
  };

  const commitTaskEdit = (id: string) => {
    if (editingTaskTitle.trim()) updateTask(id, { title: editingTaskTitle.trim() });
    setEditingTaskId(null);
  };

  // Close task menu on outside click
  useDismissibleLayer({
    open: showTaskMenu,
    onDismiss: () => setShowTaskMenu(false),
    refs: [taskMenuRef],
  });

  // Close calendar menu on outside click
  useDismissibleLayer({
    open: showCalendarMenu,
    onDismiss: () => setShowCalendarMenu(false),
    refs: [calendarMenuRef],
  });

  // Close full-screen schedule on Escape
  useEffect(() => {
    if (!showSchedule) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSchedule(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSchedule]);

  const renderEvent = useCallback((event: CalendarEvent) => {
    const startTime = event.start.dateTime ? parseISO(event.start.dateTime) : parseISO(event.start.date ?? '');
    const endTime = event.end.dateTime ? parseISO(event.end.dateTime) : parseISO(event.end.date ?? '');
    const isAllDay = !event.start.dateTime;
    const isPast = isBefore(endTime, currentTime) && !isAllDay;
    const isCurrent = isBefore(startTime, currentTime) && isAfter(endTime, currentTime) && !isAllDay;

    return (
      <div key={event.id} className={`relative pl-8 transition-opacity ${isPast ? 'opacity-35' : ''}`}>
        {/* Current-time bar — anchored to the very left of the outer container */}
        {isCurrent && (
          <div
            className="absolute -left-6 top-1/2 -translate-y-1/2 w-[3px] h-9 bg-primary rounded-full shadow-glow"
            aria-hidden="true"
          />
        )}
        {/* Timeline dot */}
        <div
          className={`absolute -left-[3px] top-[5px] w-[7px] h-[7px] rounded-full transition-colors ${
            isCurrent
              ? 'bg-primary shadow-glow'
              : isPast
                ? 'bg-white/15'
                : 'bg-white/10 border border-white/20'
          }`}
          aria-hidden="true"
        />
        {/* Time label */}
        <p className={`text-[11px] font-mono mb-0.5 ${isCurrent ? 'text-primary font-semibold' : 'text-text-muted'}`}>
          {isAllDay
            ? 'All Day'
            : `${fmtTime.format(startTime)} – ${fmtTime.format(endTime)}${isCurrent ? ' • Now' : ''}`}
        </p>
        {/* Event title */}
        <p className={`text-sm font-semibold leading-snug ${isPast ? 'text-foreground/50' : 'text-foreground'}`}>
          {event.summary || 'Busy'}
        </p>
      </div>
    );
  }, [currentTime, fmtTime]);

  const renderCalendarBody = useCallback((opts: { compact: boolean }) => {
    if (isLoadingEvents) {
      return opts.compact ? (
        <div className="flex items-center justify-center h-full">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        </div>
      ) : (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-label="Loading events" />
        </div>
      );
    }

    const wrapClass = opts.compact ? 'h-full' : 'py-16';
    const primaryBtnClass = opts.compact
      ? 'px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-foreground transition-colors border border-white/10'
      : 'px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-foreground transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';

    const goIntegrations = () => {
      if (!opts.compact) setShowSchedule(false);
      setCurrentView('Integrations');
    };

    if (calendarError === 'login_required') {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-3 ${wrapClass}`}>
          <span className="material-symbols-outlined text-4xl text-accent" aria-hidden="true">lock</span>
          <p className="text-sm text-foreground font-medium">Session expired</p>
          <p className="text-xs text-text-muted max-w-[260px]">Refresh the page and re-enter your dashboard passcode.</p>
          <button onClick={() => window.location.reload()} className={primaryBtnClass}>Refresh</button>
        </div>
      );
    }

    if (calendarError === 'google_profile_missing') {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-3 ${wrapClass}`}>
          <span className="material-symbols-outlined text-4xl text-accent" aria-hidden="true">account_circle</span>
          <p className="text-sm text-foreground font-medium">Google account not connected</p>
          <p className="text-xs text-text-muted max-w-[260px]">Go to Integrations and reconnect Google.</p>
          <button onClick={goIntegrations} className={primaryBtnClass}>Go to Integrations</button>
        </div>
      );
    }

    if (calendarError === 'not_allowlisted') {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-3 ${wrapClass}`}>
          <span className="material-symbols-outlined text-4xl text-accent" aria-hidden="true">block</span>
          <p className="text-sm text-foreground font-medium">Google account not allowlisted</p>
          <p className="text-xs text-text-muted max-w-[260px]">Add your email to <span className="font-mono">ALLOWED_GOOGLE_EMAILS</span>, then refresh.</p>
          <button onClick={goIntegrations} className={primaryBtnClass}>Go to Integrations</button>
        </div>
      );
    }

    if (!isCalendarConnected) {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-4 ${wrapClass}`}>
          <span className="material-symbols-outlined text-4xl text-text-muted" aria-hidden="true">calendar_today</span>
          <p className="text-sm text-text-muted">Connect your Google Calendar to see your schedule.</p>
          <button onClick={goIntegrations} className={primaryBtnClass}>Go to Integrations</button>
        </div>
      );
    }

    if (calendarError === 'api_disabled') {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-3 ${wrapClass}`}>
          <span className="material-symbols-outlined text-4xl text-accent" aria-hidden="true">warning</span>
          <p className="text-sm text-foreground font-medium">Google Calendar API not enabled</p>
          <p className="text-xs text-text-muted max-w-[260px]">Enable it in your Google Cloud project, then reconnect.</p>
          <a
            href="https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview"
            target="_blank"
            rel="noreferrer"
            className={primaryBtnClass}
          >
            Enable Calendar API →
          </a>
        </div>
      );
    }

    if (calendarError === 'fetch_error' || calendarError === 'network_error' || calendarError === 'forbidden') {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-3 ${wrapClass}`}>
          <span className="material-symbols-outlined text-3xl text-text-muted" aria-hidden="true">sync_problem</span>
          <p className="text-sm text-text-muted">Failed to load events.</p>
          <button onClick={fetchEvents} className={primaryBtnClass}>Retry</button>
        </div>
      );
    }

    if (sortedEvents.length === 0) {
      return (
        <div className={`flex flex-col items-center justify-center text-center gap-2 ${wrapClass}`}>
          <p className="text-sm text-text-muted">No events today.</p>
          <button
            onClick={goIntegrations}
            className="text-xs text-primary hover:underline font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
          >
            If you expect events, reconnect Google →
          </button>
        </div>
      );
    }

    return sortedEvents.map(renderEvent);
  }, [
    isLoadingEvents,
    sortedEvents,
    isCalendarConnected,
    calendarError,
    fetchEvents,
    renderEvent,
    setCurrentView,
    setShowSchedule,
  ]);

  return (
    <div className="relative z-10 flex flex-col flex-1 h-screen overflow-hidden px-8 py-10 max-w-[1440px] mx-auto w-full">
      <header className="flex justify-between items-end mb-8 flex-shrink-0">
        <div className="flex flex-col gap-1.5">
          <ClockDisplay />
        </div>
        <div className="flex gap-3 items-center">
          <div className="flex items-center gap-2 glass-panel !rounded-full px-4 py-2 text-xs text-text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
            Online
          </div>
          <button onClick={() => setCurrentView('Settings')} aria-label="Settings" className="glass-panel p-2.5 rounded-full flex items-center justify-center group btn-interact focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            <span className="material-symbols-outlined text-text-muted group-hover:text-primary transition-colors text-[20px]" aria-hidden="true">tune</span>
          </button>
        </div>
      </header>

      {showOnboarding && tasks.length === 0 && !isCalendarConnected && (
        <div className="flex-shrink-0 mb-6 glass-panel rounded-xl p-4 border-l-4 border-primary/60 flex items-start gap-4">
          <span className="material-symbols-outlined text-primary text-[24px] flex-shrink-0 mt-0.5" aria-hidden="true">waving_hand</span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground mb-1">Welcome to your dashboard!</p>
            <p className="text-xs text-text-muted">Get started by connecting your Google account for Calendar &amp; Gmail, or hit <span className="text-primary font-mono">+</span> to add your first task.</p>
            <button onClick={() => setCurrentView('Integrations')} className="mt-2 text-xs text-primary hover:underline font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
              Connect integrations
            </button>
          </div>
          <button
            onClick={() => { localStorage.setItem(STORAGE_KEYS.onboardingDismissed, '1'); setShowOnboarding(false); }}
            aria-label="Dismiss welcome banner"
            className="text-text-muted hover:text-foreground transition-colors flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
          >
            <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
          </button>
        </div>
      )}

      <main
        className="flex-1 overflow-y-auto pr-4 pb-12 custom-scrollbar"
        style={{ contentVisibility: 'auto' as any, containIntrinsicSize: '1100px 900px' as any }}
      >
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-[minmax(200px,_auto)]">

          <DashboardDigestCard
            setCurrentView={setCurrentView}
            gmailConnected={gmailConnected}
            gmailServerError={gmailServerError}
            unreadCount={unreadCount}
            githubConnected={githubConnected}
            githubUnreadCount={githubNotifs.length}
            discordWebhookConfigured={discordWebhookConfigured}
            calendarConnected={isCalendarConnected && !calendarError}
            nextEventSnippet={digestNextEventSnippet}
            calendarEvents={events}
            remainingTasks={remainingTasks}
            aiConfigured={aiConfigured}
          />

          {/* Calendar Widget */}
          <div className="glass-panel col-span-1 md:col-span-2 row-span-2 p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/80 via-primary/30 to-transparent pointer-events-none"></div>
            <div className="flex justify-between items-center mb-8">
              <button
                onClick={() => setShowSchedule(true)}
                className="font-heading text-xl text-foreground flex items-center gap-3 hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                aria-label="Open full schedule"
              >
                <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">event_note</span>
                Schedule
              </button>
              <div className="flex items-center gap-1">
                <button onClick={fetchEvents} aria-label="Refresh calendar" className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-primary hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="material-symbols-outlined !text-sm" aria-hidden="true">refresh</span></button>
                <div className="relative" ref={calendarMenuRef}>
                  <button onClick={() => setShowCalendarMenu(v => !v)} aria-label="Calendar options" aria-expanded={showCalendarMenu} className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-primary hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="material-symbols-outlined !text-sm" aria-hidden="true">more_vert</span></button>
                  {showCalendarMenu && (
                    <div className="absolute top-8 right-0 z-50 glass-panel rounded-lg overflow-hidden border border-white/10 shadow-xl min-w-[180px]">
                      <button
                        onClick={() => { fetchEvents(); setShowCalendarMenu(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined !text-sm">refresh</span>
                        Refresh
                      </button>
                      <button
                        onClick={() => { setShowSchedule(true); setShowCalendarMenu(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined !text-sm">open_in_full</span>
                        Full schedule
                      </button>
                      <a
                        href="https://calendar.google.com"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setShowCalendarMenu(false)}
                        className="w-full text-left px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined !text-sm">open_in_new</span>
                        Open Google Calendar
                      </a>
                    </div>
                  )}
                </div>
                <div className="w-px h-4 bg-white/10 mx-1"></div>
                <button
                  onClick={() => setCurrentView('FocusMode')}
                  className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary-subtle px-4 py-1.5 rounded-full hover:bg-primary/20 transition-colors border border-primary/20 btn-interact"
                >
                  Focus Mode
                </button>
              </div>
            </div>
            <div className="relative flex-1 flex flex-col gap-7 pl-6">
              <div className="absolute left-1 top-2 bottom-0 w-[1px] bg-border-glass" />
              {renderCalendarBody({ compact: true })}
            </div>
          </div>

          {/* System — this machine (shared /api/system poll) */}
          <SystemMetricsTile />

          {/* Tasks */}
          <div id="main-tasks-panel" className="glass-panel col-span-1 row-span-2 p-7 flex flex-col relative overflow-hidden scroll-mt-4">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-green-400/70 via-green-400/20 to-transparent pointer-events-none"></div>
            <div className="flex justify-between items-center mb-8">
              <h2 className="font-heading text-lg text-foreground flex items-center gap-3">
                <span className="material-symbols-outlined text-text-muted text-[22px]" aria-hidden="true">checklist</span>
                Tasks
              </h2>
              <div className="flex items-center gap-1" ref={taskMenuRef}>
                <span className="text-[10px] font-mono text-text-muted bg-surface px-2 py-0.5 rounded mr-1">{remainingTasks} LEFT</span>
                <button
                  onClick={() => { setShowQuickAdd(true); setTimeout(() => quickAddRef.current?.focus(), 50); }}
                  aria-label="Add task"
                  className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-primary hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="material-symbols-outlined !text-sm" aria-hidden="true">add</span>
                </button>
                <button
                  onClick={() => setShowTaskMenu(v => !v)}
                  aria-label="Task options"
                  aria-expanded={showTaskMenu}
                  className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-foreground hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="material-symbols-outlined !text-sm" aria-hidden="true">more_vert</span>
                </button>
                {showTaskMenu && (
                  <div className="absolute top-16 right-6 z-50 glass-panel rounded-lg overflow-hidden border border-white/10 shadow-xl min-w-[160px]">
                    <button
                      onClick={() => { clearCompletedTasks(); setShowTaskMenu(false); showToast('Completed tasks cleared', 'info'); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-foreground/80 hover:bg-white/10 hover:text-foreground transition-colors flex items-center gap-2"
                    >
                      <span className="material-symbols-outlined !text-sm">delete_sweep</span>
                      Clear completed
                    </button>
                  </div>
                )}
              </div>
            </div>
            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 opacity-60">
                <span className="material-symbols-outlined text-3xl text-text-muted">task_alt</span>
                <p className="text-sm text-text-muted">No tasks yet.<br/>Click + to add one.</p>
              </div>
            ) : (
            <div className="flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
              {activeTasks.map(task => {
                const overdue = isOverdue(task, todayStart);
                const pStyle = task.priority ? PRIORITY_STYLES[task.priority as TaskPriority] : null;
                return (
                <div key={task.id} className={`group/task flex items-start gap-3 p-3 rounded-xl hover:bg-surface-hover transition-[background-color,border-color] border ${overdue ? 'border-red-500/30 bg-red-500/5' : 'border-transparent hover:border-border-glass'}`}>
                  <button
                    onClick={() => toggleTask(task.id)}
                    role="checkbox"
                    aria-checked={task.completed}
                    aria-label={task.title}
                    className={`mt-1 w-5 h-5 rounded-md border-2 flex-shrink-0 transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                      pStyle
                        ? `${pStyle.checkboxBorder} ${pStyle.checkboxHover}`
                        : 'border-border-glass group-hover/task:border-primary/50'
                    }`}
                  />
                  <div className="flex flex-col flex-1 min-w-0">
                    {editingTaskId === task.id ? (
                      <input
                        aria-label={`Edit task: ${task.title}`}
                        className="bg-white/5 border border-primary/40 rounded px-2 py-0.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 w-full"
                        value={editingTaskTitle}
                        onChange={e => setEditingTaskTitle(e.target.value)}
                        onBlur={() => commitTaskEdit(task.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitTaskEdit(task.id); if (e.key === 'Escape') setEditingTaskId(null); }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setEditingTaskId(task.id); setEditingTaskTitle(task.title); }}
                        className="text-left text-sm font-medium text-foreground cursor-text transition-colors group-hover/task:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                      >{task.title}</button>
                    )}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {pStyle && (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${pStyle.badge}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${pStyle.dot}`} aria-hidden="true" />
                          {pStyle.label}
                        </span>
                      )}
                      {task.dueDate && (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${overdue ? 'text-red-400' : 'text-text-muted'}`}>
                          <span className="material-symbols-outlined !text-[11px]" aria-hidden="true">calendar_today</span>
                          {formatDueDate(task.dueDate, todayStart)}
                        </span>
                      )}
                      {task.tags && task.tags.length > 0 && task.tags.map((tag) => (
                        <span key={tag} className="inline-flex items-center gap-1 text-[10px] font-medium text-primary bg-primary/5 border border-primary/20 px-1.5 py-0.5 rounded">
                          <span className="material-symbols-outlined !text-[10px]" aria-hidden="true">label</span>
                          {tag}
                        </span>
                      ))}
                      {overdue && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-400 uppercase tracking-wide">
                          <span className="material-symbols-outlined !text-[11px]" aria-hidden="true">warning</span>
                          Overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deleteTask(task.id)}
                    aria-label={`Delete task: ${task.title}`}
                    className="opacity-0 group-hover/task:opacity-100 transition-opacity text-text-muted hover:text-accent flex-shrink-0 mt-0.5 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                  >
                    <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                  </button>
                </div>
                );
              })}
              {completedTasks.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border-glass">
                  {completedTasks.map(task => (
                    <div key={task.id} className="group/done flex items-start gap-3 p-3 rounded-xl opacity-40 hover:opacity-70 transition-opacity">
                      <button
                        onClick={() => toggleTask(task.id)}
                        role="checkbox"
                        aria-checked={true}
                        aria-label={`Mark incomplete: ${task.title}`}
                        className="mt-1 w-5 h-5 rounded-md bg-primary/20 flex items-center justify-center text-primary cursor-pointer flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <span className="material-symbols-outlined !text-[14px] !font-bold" aria-hidden="true">check</span>
                      </button>
                      <span className="text-sm text-text-muted line-through flex-1">{task.title}</span>
                      <button onClick={() => deleteTask(task.id)} aria-label={`Delete task: ${task.title}`} className="opacity-0 group-hover/done:opacity-100 transition-opacity text-text-muted hover:text-accent flex-shrink-0 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
                        <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            )}
          </div>

          {/* Triage */}
          <button
            onClick={() => setCurrentView('Communications')}
            className="glass-panel col-span-1 row-span-1 p-6 flex flex-col relative group/box cursor-pointer overflow-hidden text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            aria-label="Open email inbox"
          >
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-orange-400/70 via-orange-400/20 to-transparent pointer-events-none"></div>
            {unreadCount > 0 && (
              <div className="absolute top-5 right-5 w-2 h-2">
                <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent shadow-[0_0_12px_rgba(251,113,133,0.55)]"></span>
              </div>
            )}
            <h2 className="font-heading text-lg text-foreground mb-auto flex items-center gap-3">
              <span className="material-symbols-outlined text-text-muted text-[22px]" aria-hidden="true">mark_email_unread</span>
              Triage
            </h2>
            <div className="mt-4">
              {gmailConnected ? (
                <>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-heading text-foreground">{unreadCount}</span>
                    <span className="text-xs text-text-muted font-medium uppercase tracking-widest">New</span>
                  </div>
                  {lastUnreadEmail ? (
                    <p className="text-xs text-text-muted truncate group-hover/box:text-foreground transition-colors">Last from <span className="text-primary group-hover/box:font-bold">{lastUnreadEmail.sender}</span></p>
                  ) : (
                    <p className="text-xs text-text-muted">Inbox zero!</p>
                  )}
                </>
              ) : gmailServerError ? (
                <p className="text-xs text-text-muted group-hover/box:text-foreground transition-colors">Server unreachable.</p>
              ) : (
                <p className="text-xs text-text-muted group-hover/box:text-foreground transition-colors">Connect Gmail to see your inbox.</p>
              )}
            </div>
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-primary/10 rounded-full blur-3xl group-hover/box:bg-primary/20 transition-colors duration-700" aria-hidden="true"></div>
          </button>

          {/* GitHub Notifications — only shown when connected */}
          {githubConnected && (
            <div className="glass-panel col-span-1 md:col-span-2 row-span-2 p-6 flex flex-col relative">
              <div className="flex justify-between items-center mb-5">
                <h2 className="font-heading text-lg text-foreground flex items-center gap-3">
                  <span className="material-symbols-outlined text-text-muted text-[22px]" aria-hidden="true">code</span>
                  GitHub
                </h2>
                {githubNotifs.length > 0 && (
                  <span className="text-[10px] font-mono text-text-muted bg-surface px-2 py-0.5 rounded">{githubNotifs.length} UNREAD</span>
                )}
              </div>
              {githubNotifs.length === 0 ? (
                <div className="flex flex-col items-center justify-center flex-1 text-center">
                  <span className="material-symbols-outlined text-3xl text-text-muted mb-2" aria-hidden="true">check_circle</span>
                  <p className="text-sm text-text-muted">All caught up!</p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto custom-scrollbar pr-1">
                  {githubNotifs.slice(0, 8).map(n => (
                    <a
                      key={n.id}
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-hover transition-[background-color,border-color] border border-transparent hover:border-border-glass group/notif"
                    >
                      <span className="material-symbols-outlined text-text-muted !text-[18px] flex-shrink-0 mt-0.5 group-hover/notif:text-primary transition-colors">{githubTypeIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground/90 font-medium truncate group-hover/notif:text-foreground">{n.title}</p>
                        <p className="text-[10px] text-text-muted mt-0.5 truncate">{n.repo}</p>
                      </div>
                      <span className="text-[10px] text-text-muted flex-shrink-0 mt-0.5 capitalize">{n.reason.replace(/_/g, ' ')}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* FAB */}
      <button
        onClick={() => { setShowQuickAdd(true); setTimeout(() => quickAddRef.current?.focus(), 50); }}
        aria-label="Add task"
        className="fixed right-10 w-16 h-16 bg-primary text-background-dark rounded-2xl flex items-center justify-center shadow-[0_12px_36px_rgba(56,189,248,0.38)] hover:shadow-[0_18px_46px_rgba(56,189,248,0.5)] transition-shadow z-50 overflow-hidden group btn-interact focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground bottom-10 max-lg:bottom-[calc(var(--app-bottom-nav-height,0px)+env(safe-area-inset-bottom,0px)+2.5rem)]"
      >
        <span className="material-symbols-outlined !text-[32px] !font-bold relative z-10" aria-hidden="true">add</span>
        <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity" aria-hidden="true"></div>
      </button>

      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-10 pointer-events-none">
          <div className="glass-panel rounded-2xl p-4 w-80 pointer-events-auto shadow-2xl border border-primary/30">
            <p className="text-xs text-primary font-bold uppercase tracking-widest mb-3">Quick Add Task</p>
            <input
              ref={quickAddRef}
              aria-label="Task title"
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-foreground placeholder-text-muted/60 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20 transition-colors"
              placeholder="Task title… (Enter to add)"
              value={quickAddTitle}
              onChange={e => setQuickAddTitle(e.target.value)}
              onKeyDown={handleQuickAdd}
            />
            {/* Group selector */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setQuickAddGroup('now')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${quickAddGroup === 'now' ? 'bg-primary text-background-dark' : 'bg-white/5 text-text-muted hover:text-foreground'}`}
              >Now</button>
              <button
                onClick={() => setQuickAddGroup('next')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-colors ${quickAddGroup === 'next' ? 'bg-primary text-background-dark' : 'bg-white/5 text-text-muted hover:text-foreground'}`}
              >Next</button>
            </div>
            {/* Priority selector */}
            <div className="flex gap-1.5 mt-3">
              <button
                onClick={() => setQuickAddPriority(undefined)}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${!quickAddPriority ? 'bg-white/15 text-foreground' : 'bg-white/5 text-text-muted hover:text-foreground'}`}
              >None</button>
              <button
                onClick={() => setQuickAddPriority('Priority')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${quickAddPriority === 'Priority' ? 'bg-yellow-400/20 text-yellow-400 border border-yellow-400/30' : 'bg-white/5 text-text-muted hover:text-yellow-400/80'}`}
              >Priority</button>
              <button
                onClick={() => setQuickAddPriority('Critical')}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${quickAddPriority === 'Critical' ? 'bg-red-400/20 text-red-400 border border-red-400/30' : 'bg-white/5 text-text-muted hover:text-red-400/80'}`}
              >Critical</button>
            </div>
            {/* Due date */}
            <div className="mt-3">
              <label htmlFor="quick-add-due-date" className="text-[10px] text-text-muted uppercase tracking-wide font-medium block mb-1">Due date (optional)</label>
              <input
                id="quick-add-due-date"
                type="date"
                value={quickAddDueDate}
                onChange={e => setQuickAddDueDate(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg py-1.5 px-3 text-sm text-foreground focus-visible:outline-none focus-visible:border-primary/50 transition-colors [color-scheme:dark]"
              />
            </div>
            {/* Tags */}
            <div className="mt-3">
              <label className="text-[10px] text-text-muted uppercase tracking-wide font-medium block mb-1">Tags (optional)</label>
              <TagInput tags={quickAddTags} onChange={setQuickAddTags} placeholder="Add tags..." maxTags={5} />
            </div>
            <p className="text-[10px] text-text-muted mt-2">Press Esc to cancel</p>
          </div>
        </div>
      )}

      {/* Full-screen schedule modal */}
      {showSchedule && (
        <div
          className="fixed inset-0 z-[500] flex flex-col"
          style={{ background: 'rgba(11,12,16,0.97)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Full schedule"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b flex-shrink-0" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">event_note</span>
              <h2 className="font-heading text-xl text-foreground">Schedule</h2>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchEvents}
                aria-label="Refresh calendar"
                className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-primary hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined !text-sm" aria-hidden="true">refresh</span>
              </button>
              <a
                href="https://calendar.google.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Open Google Calendar"
                className="w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-primary hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined !text-sm" aria-hidden="true">open_in_new</span>
              </a>
              <div className="w-px h-4 bg-white/10 mx-1" aria-hidden="true" />
              <button
                onClick={() => { setShowSchedule(false); setCurrentView('FocusMode'); }}
                className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-4 py-1.5 rounded-full hover:bg-primary/20 transition-colors border border-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Focus Mode
              </button>
              <button
                onClick={() => setShowSchedule(false)}
                aria-label="Close schedule"
                className="ml-2 w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-foreground hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          {/* Event list */}
          <div className="flex-1 overflow-y-auto px-8 py-8 custom-scrollbar">
            <div className="max-w-2xl mx-auto">
              <div className="relative flex flex-col gap-7 pl-6">
                <div className="absolute left-1 top-2 bottom-0 w-[1px] bg-border-glass" />
                {renderCalendarBody({ compact: false })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
