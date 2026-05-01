import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { format } from 'date-fns';

import { Task } from '../types/task';
import { useTaskContext } from '../contexts/taskContext';
import { useCalendarEvents } from '../hooks/useCalendarEvents';
import { useCalendarNotifications } from '../hooks/useCalendarNotifications';
import type { SetViewFn } from '../config/navigation';
import {
  formatCalendarEventTime,
  splitCalendarEvents,
  type CalendarDisplayItem,
} from '../lib/calendarDisplay';

/** Timer presets. `isBreak` determines cosmetic colour in the UI. */
const PRESETS = [
  { label: '5 min', seconds: 5 * 60, isBreak: true },
  { label: '10 min', seconds: 10 * 60, isBreak: true },
  { label: '25 min', seconds: 25 * 60, isBreak: false },
  { label: '50 min', seconds: 50 * 60, isBreak: false },
] as const;

const POMODORO_KEY = 'dashboard_pomodoro_sessions';

const FOCUS_EVENT_META: Record<CalendarDisplayItem['state'], { label: string; dot: string; pill: string }> = {
  allDay: {
    label: 'All day',
    dot: 'bg-sky-300/70 border border-sky-200/40',
    pill: 'border-sky-300/20 bg-sky-300/10 text-sky-200',
  },
  current: {
    label: 'Now',
    dot: 'bg-primary shadow-[0_0_10px_rgba(56,189,248,0.45)]',
    pill: 'border-primary/25 bg-primary/10 text-primary',
  },
  upcoming: {
    label: 'Next',
    dot: 'bg-white/15 border border-white/25',
    pill: 'border-white/10 bg-white/[0.04] text-text-muted',
  },
  past: {
    label: 'Done',
    dot: 'bg-white/10 border border-white/15',
    pill: 'border-white/10 bg-white/[0.03] text-text-muted/80',
  },
};

function todayKey(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function loadSessionsData(): Record<string, number> {
  try {
    const raw = localStorage.getItem(POMODORO_KEY);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function saveSessionsData(data: Record<string, number>) {
  try { localStorage.setItem(POMODORO_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

/** Plays a short triple-beep completion sound via the Web Audio API. */
function playCompletionSound() {
  try {
    const ctx = new AudioContext();
    const beepAt = (startTime: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.35, startTime + 0.01);
      gain.gain.linearRampToValueAtTime(0, startTime + 0.18);
      osc.start(startTime);
      osc.stop(startTime + 0.2);
    };
    beepAt(ctx.currentTime);
    beepAt(ctx.currentTime + 0.25);
    beepAt(ctx.currentTime + 0.5);
    // Close context after all beeps finish
    setTimeout(() => ctx.close(), 1500);
  } catch {
    // AudioContext may be unavailable in some environments — silently ignore
  }
}

export default function FocusMode({ setCurrentView }: { setCurrentView: SetViewFn }) {
  const { state: { tasks }, actions: { toggleTask, addTask, deleteTask, updateTask } } = useTaskContext();

  const [selectedPreset, setSelectedPreset] = useState(2); // default to 25 min
  const [timeLeft, setTimeLeft] = useState(PRESETS[2].seconds);
  const [isActive, setIsActive] = useState(false);
  const justCompletedRef = useRef(false);

  // Pomodoro session count
  const [sessionsData, setSessionsData] = useState<Record<string, number>>(loadSessionsData);
  const todayCount = sessionsData[todayKey()] ?? 0;

  // Streak: consecutive days with at least 1 session
  const streak = useMemo(() => {
    const data = sessionsData;
    let count = 0;
    let checkDate = new Date();
    // Don't count today if no sessions yet
    while (true) {
      const key = format(checkDate, 'yyyy-MM-dd');
      if (!(data[key] > 0)) break;
      count++;
      checkDate = new Date(checkDate.getTime() - 86_400_000);
    }
    return count;
  }, [sessionsData]);

  const { events, mode: calendarMode, isLoading: isLoadingEvents, isConnected: isCalendarConnected, error: calendarError } = useCalendarEvents();
  useCalendarNotifications(events, isCalendarConnected);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Tick + completion in one effect — stops the timer inside the updater
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          setIsActive(false);
          justCompletedRef.current = true;
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  // Handle completion side effects (sound + session increment)
  useEffect(() => {
    if (!justCompletedRef.current) return;
    justCompletedRef.current = false;

    // Only count focus sessions (non-break) as Pomodoros
    const preset = PRESETS[selectedPreset];
    if (!preset.isBreak) {
      const key = todayKey();
      setSessionsData(prev => {
        const updated = { ...prev, [key]: (prev[key] ?? 0) + 1 };
        saveSessionsData(updated);
        return updated;
      });
    }

    playCompletionSound();
  }, [selectedPreset]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const selectPreset = useCallback((index: number) => {
    setSelectedPreset(index);
    setIsActive(false);
    setTimeLeft(PRESETS[index].seconds);
  }, []);

  const toggleTimer = () => setIsActive(!isActive);
  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(PRESETS[selectedPreset].seconds);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentPreset = PRESETS[selectedPreset];
  const isBreak = currentPreset.isBreak;

  const [newTaskTitle, setNewTaskTitle] = useState('');

  const handleAddTask = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newTaskTitle.trim()) {
      addTask({
        id: crypto.randomUUID(),
        title: newTaskTitle.trim(),
        completed: false,
        group: 'now'
      });
      setNewTaskTitle('');
    }
  };

  const { remainingTasks, nowTasks, nextTasks } = useMemo(() => {
    let remaining = 0;
    const now: Task[] = [], next: Task[] = [];
    for (const t of tasks) {
      if (!t.completed) remaining++;
      (t.group === 'now' ? now : next).push(t);
    }
    return { remainingTasks: remaining, nowTasks: now, nextTasks: next };
  }, [tasks]);

  const scheduleGroups = useMemo(() => splitCalendarEvents(events, currentTime), [events, currentTime]);

  const renderTimelineEvent = (item: CalendarDisplayItem) => {
    const meta = FOCUS_EVENT_META[item.state];
    const isCurrent = item.state === 'current';
    const isPast = item.state === 'past';
    const timeLabel = formatCalendarEventTime(item, calendarMode === 'upcoming' ? 'upcoming' : 'today');

    if (isCurrent) {
      return (
        <div key={item.event.id} className="relative pl-12 mb-10">
          <div className={`absolute left-[20px] top-1.5 w-2 h-2 rounded-full z-10 ${meta.dot}`} aria-hidden="true" />
          <div className="mb-2 flex items-center gap-2">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${meta.pill}`}>{meta.label}</span>
            <span className="text-xs text-primary/80 font-mono">{timeLabel}</span>
          </div>
          <div className="p-6 rounded-xl bg-primary/[0.08] border border-primary/25 relative overflow-hidden group transition-colors duration-300 hover:bg-primary/[0.12]">
            <h3 className="font-heading text-2xl font-bold text-white leading-tight tracking-tight">{item.title}</h3>
            <a
              href={item.event.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-2 text-xs text-primary/70 hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">open_in_new</span>
              View in Calendar
            </a>
          </div>
        </div>
      );
    }

    return (
      <div key={item.event.id} className={`relative pl-12 mb-8 ${isPast ? 'opacity-65' : ''}`}>
        <div className={`absolute left-[20px] top-1.5 w-2 h-2 rounded-full z-10 ${meta.dot}`} aria-hidden="true" />
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${meta.pill}`}>{meta.label}</span>
          <span className="text-xs text-text-muted font-mono">{timeLabel}</span>
        </div>
        <div className={`p-4 rounded-lg border ${isPast ? 'bg-white/[0.025] border-white/8' : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.07] transition-colors group'}`}>
          <h3 className={`font-medium ${isPast ? 'text-slate-400' : 'text-slate-100 group-hover:text-white transition-colors'}`}>
            {item.title}
          </h3>
        </div>
      </div>
    );
  };

  const renderTimeline = () => {
    if (isLoadingEvents) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        </div>
      );
    }
    if (calendarError === 'not_allowlisted') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-rose-400">block</span>
          <p className="text-sm text-white font-medium">Google account not allowlisted</p>
          <p className="text-xs text-text-muted max-w-[280px]">Add your Google email to <span className="font-mono">ALLOWED_GOOGLE_EMAILS</span>, then refresh.</p>
          <button onClick={() => setCurrentView('Integrations')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Go to Integrations
          </button>
        </div>
      );
    }
    if (calendarError === 'login_required') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-rose-400">lock</span>
          <p className="text-sm text-white font-medium">Session expired</p>
          <p className="text-xs text-text-muted max-w-[280px]">Refresh the page and re-enter your dashboard passcode.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Refresh
          </button>
        </div>
      );
    }
    if (calendarError === 'google_profile_missing') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-rose-400">account_circle</span>
          <p className="text-sm text-white font-medium">Google account not connected</p>
          <p className="text-xs text-text-muted max-w-[280px]">Go to Integrations and reconnect Google.</p>
          <button onClick={() => setCurrentView('Integrations')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Go to Integrations
          </button>
        </div>
      );
    }
    if (!isCalendarConnected) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-4">
          <span className="material-symbols-outlined text-4xl text-text-muted">calendar_today</span>
          <p className="text-sm text-text-muted">Connect your Google Calendar to see your schedule.</p>
          <button onClick={() => setCurrentView('Integrations')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Go to Integrations
          </button>
        </div>
      );
    }
    if (calendarError === 'api_disabled') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-rose-400">warning</span>
          <p className="text-sm text-white font-medium">Google Calendar API not enabled</p>
          <p className="text-xs text-text-muted max-w-[280px]">Enable it in your Google Cloud project, then reconnect.</p>
          <a href="https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview" target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-xs font-medium text-primary transition-colors border border-primary/20">
            Enable Calendar API →
          </a>
        </div>
      );
    }
    if (calendarError === 'calendar_access_denied') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-amber-400">event_busy</span>
          <p className="text-sm text-white font-medium">Calendar access denied</p>
          <p className="text-xs text-text-muted max-w-[280px]">
            Reconnect Google under Integrations so Calendar scope is granted again.
          </p>
          <button onClick={() => setCurrentView('Integrations')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Go to Integrations
          </button>
        </div>
      );
    }

    const nowItems = [
      ...[...scheduleGroups.current].sort((a, b) => a.sortMs - b.sortMs),
      ...[...scheduleGroups.allDay].sort((a, b) => a.sortMs - b.sortMs),
    ];
    const nextItems = calendarMode === 'upcoming' ? scheduleGroups.primary : scheduleGroups.upcoming;
    const hasInsertedIndicator = scheduleGroups.displayable.length > 0;

    return (
      <>
        {calendarMode !== 'upcoming' && scheduleGroups.earlier.length > 0 && (
          <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted/80">Done</div>
        )}
        {calendarMode !== 'upcoming' && scheduleGroups.earlier.map(renderTimelineEvent)}

        {hasInsertedIndicator && (
          <div className="relative pl-12 mb-8 flex items-center gap-3">
            <div className="absolute left-[16px] w-4 h-4 rounded-full bg-primary z-10 shadow-[0_0_12px_rgba(56,189,248,0.35)]"></div>
            <div className="flex-1 h-px bg-primary/40 ml-4"></div>
            <span className="text-[11px] font-bold text-primary bg-primary/10 border border-primary/25 px-2 py-1 rounded shrink-0">
              {format(currentTime, 'h:mm a')}
            </span>
          </div>
        )}

        {scheduleGroups.displayable.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2">
            <p className="text-sm text-text-muted">No events scheduled.</p>
            <button
              onClick={() => setCurrentView('Integrations')}
              className="text-xs text-primary hover:underline font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
            >
              If you expected events, reconnect Google →
            </button>
          </div>
        )}

        {calendarMode !== 'upcoming' && nowItems.length > 0 && (
          <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted/80">Now</div>
        )}
        {calendarMode !== 'upcoming' && nowItems.map(renderTimelineEvent)}

        {nextItems.length > 0 && (
          <div className="mb-4 text-[10px] font-mono uppercase tracking-[0.2em] text-text-muted/80">
            {calendarMode === 'upcoming' ? 'Upcoming' : 'Next'}
          </div>
        )}
        {nextItems.map(renderTimelineEvent)}

        <div className="relative pl-12 mt-4 mb-8 opacity-40">
          <div className="absolute left-[16px] top-1 w-4 h-4 rounded-full border-2 border-dashed border-white/40 bg-transparent z-10"></div>
          <div className="text-xs text-text-muted italic font-medium">
            {calendarMode === 'upcoming' ? 'End of upcoming window' : 'End of scheduled day'}
          </div>
        </div>
      </>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <header className="flex-none px-8 py-6 flex justify-between items-center z-50">
        <button
          onClick={() => setCurrentView('MainHub')}
          className="flex items-center gap-2 text-slate-400 hover:text-primary transition-[color,transform] group scale-100 hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
        >
          <span className="material-symbols-outlined text-xl transition-transform group-hover:-translate-x-1" aria-hidden="true">arrow_back</span>
          <span className="font-medium text-sm tracking-wide">Exit Focus</span>
        </button>
        <div className="font-heading font-semibold text-xl tracking-wider text-slate-100 opacity-80">
          FOCUS MODE
        </div>
        <div className="flex items-center gap-4">
          {/* Timer presets */}
          <div className="hidden sm:flex items-center gap-1 glass-panel rounded-full px-2 py-1.5 border-white/10">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => selectPreset(i)}
                className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                  selectedPreset === i
                    ? p.isBreak
                      ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                      : 'bg-primary/20 text-primary border border-primary/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >{p.label}</button>
            ))}
          </div>
          {/* Timer control */}
          <div className={`glass-panel rounded-full px-5 py-2 flex items-center gap-4 border-white/20 transition-colors hover:border-primary/40 group ${isActive ? (isBreak ? 'shadow-[0_0_15px_rgba(74,222,128,0.2)]' : 'shadow-[0_0_15px_rgba(6,232,249,0.2)]') : ''}`}>
            <div className="flex flex-col items-center">
              <span className={`text-[10px] font-bold uppercase tracking-tighter leading-none mb-0.5 ${isActive ? (isBreak ? 'text-green-400' : 'text-primary') : 'text-slate-400'} ${isActive ? 'group-hover:animate-pulse' : ''}`}>
                {isActive ? (isBreak ? 'Break' : 'Focusing') : timeLeft === currentPreset.seconds ? 'Ready' : 'Paused'}
              </span>
              <span className={`text-lg font-heading font-bold tabular-nums leading-none ${isActive ? 'text-white' : 'text-slate-300'}`}>
                {formatTime(timeLeft)}
              </span>
            </div>
            <div className="w-px h-6 bg-white/10 mx-1"></div>
            <div className="flex items-center gap-1">
              <button onClick={toggleTimer} aria-label={isActive ? 'Pause focus timer' : 'Resume focus timer'} className="tooltip w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" data-tooltip={isActive ? "Pause Focus" : "Resume Focus"}>
                <span className="material-symbols-outlined text-xl" aria-hidden="true">{isActive ? 'pause' : 'play_arrow'}</span>
              </button>
              <button onClick={resetTimer} aria-label="Reset timer" className="tooltip w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-white hover:bg-white/10 transition-colors active:scale-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" data-tooltip="Reset Timer">
                <span className="material-symbols-outlined text-xl" aria-hidden="true">replay</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 flex gap-6 px-8 pb-8 overflow-hidden max-w-[1800px] mx-auto w-full">
        {/* Left Column: Timeline */}
        <section className="w-3/5 h-full flex flex-col relative glass-panel rounded-xl overflow-hidden flex-none">
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-background-dark/85 to-transparent z-20 pointer-events-none rounded-t-xl"></div>
          <div className="p-6 pb-2 z-30 bg-background-elevated/50 backdrop-blur-md border-b border-white/5">
            <h2 className="font-heading text-2xl font-semibold text-slate-100">Timeline</h2>
            <p className="text-xs text-text-muted uppercase tracking-widest mt-1 font-semibold">
              {calendarMode === 'upcoming' ? 'Upcoming' : 'Today'}
            </p>
          </div>
          <div className="flex-1 overflow-y-auto relative px-6 py-12">
            <div className="timeline-line"></div>
            {renderTimeline()}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background-dark/85 to-transparent z-20 pointer-events-none rounded-b-xl"></div>
        </section>

        {/* Right Column: Tasks */}
        <section className="w-2/5 h-full flex flex-col gap-6 flex-none">
          <div className="glass-panel rounded-xl flex-1 flex flex-col overflow-hidden relative transition-colors duration-300 hover:border-white/20">
            <div className="p-6 pb-4 z-30 bg-background-elevated/50 backdrop-blur-md border-b border-white/5">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-slate-100">Action Items</h2>
                  <p className="text-xs text-text-muted mt-1 font-medium transition-opacity" id="task-status">{remainingTasks} tasks remaining</p>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-primary/60 text-[20px] group-focus-within:text-primary transition-colors" aria-hidden="true">add_circle</span>
                </div>
                <input
                  aria-label="Add a task"
                  name="task-title"
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder:text-white/20 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20 transition-colors"
                  placeholder="Add a quick task…"
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={handleAddTask}
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-8">
              {/* Group: Now */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse motion-reduce:animate-none" aria-hidden="true"></span>
                  <h3 className="text-xs font-bold text-slate-100 uppercase tracking-widest">Now</h3>
                  <div className="flex-1 h-px bg-white/10 ml-2"></div>
                </div>
                <div className="flex flex-col gap-2">
                  {nowTasks.map(task => (
                    <div key={task.id} className={`flex items-start gap-3 p-3 rounded-lg bg-white/5 border border-white/10 transition-[background-color,transform] group hover:bg-white/10 hover:translate-x-1 ${task.completed ? 'opacity-50' : ''}`}>
                      <input
                        className="glass-checkbox mt-0.5 cursor-pointer"
                        type="checkbox"
                        aria-label={task.title}
                        checked={task.completed}
                        onChange={() => toggleTask(task.id)}
                      />
                      <div className="flex-1">
                        <p className={`text-sm font-medium transition-colors ${task.completed ? 'text-slate-400 line-through' : 'text-slate-100 group-hover:text-primary'}`}>
                          {task.title}
                        </p>
                        {task.description && (
                          <p className="text-xs text-text-muted mt-1 line-clamp-1">{task.description}</p>
                        )}
                      </div>
                      {task.priority && !task.completed && (
                        <span className={`px-2 py-0.5 rounded text-[10px] border flex-shrink-0 ${task.priority === 'Critical' ? 'bg-red-500/20 text-red-300 border-red-500/20' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/20'}`}>{task.priority}</span>
                      )}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => updateTask(task.id, { group: 'next' })}
                          aria-label="Move to Next"
                          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-orange-400 hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span className="material-symbols-outlined !text-sm" aria-hidden="true">arrow_downward</span>
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          aria-label={`Delete task: ${task.title}`}
                          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-rose-400 hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {nowTasks.length === 0 && (
                    <p className="text-xs text-text-muted italic px-2">Nothing here yet</p>
                  )}
                </div>
              </div>

              {/* Group: Next */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <span className="w-2 h-2 rounded-full bg-orange-400"></span>
                  <h3 className="text-xs font-bold text-slate-100 uppercase tracking-widest">Next</h3>
                  <div className="flex-1 h-px bg-white/10 ml-2"></div>
                </div>
                <div className="flex flex-col gap-2">
                  {nextTasks.map(task => (
                    <div key={task.id} className={`flex items-start gap-3 p-3 rounded-lg border border-transparent cursor-pointer hover:bg-white/5 transition-[background-color,border-color,transform] group hover:translate-x-1 hover:border-white/10 ${task.completed ? 'opacity-50' : ''}`}>
                      <input
                        className="glass-checkbox mt-0.5 cursor-pointer"
                        type="checkbox"
                        aria-label={task.title}
                        checked={task.completed}
                        onChange={() => toggleTask(task.id)}
                      />
                      <div className="flex-1">
                        <p className={`text-sm font-medium transition-colors ${task.completed ? 'text-slate-400 line-through' : 'text-slate-200 group-hover:text-white'}`}>
                          {task.title}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                        <button
                          onClick={() => updateTask(task.id, { group: 'now' })}
                          aria-label="Move to Now"
                          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-primary hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span className="material-symbols-outlined !text-sm" aria-hidden="true">arrow_upward</span>
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          aria-label={`Delete task: ${task.title}`}
                          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-rose-400 hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                        >
                          <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                        </button>
                      </div>
                    </div>
                  ))}
                  {nextTasks.length === 0 && (
                    <p className="text-xs text-text-muted italic px-2">Nothing queued</p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Session Info + Pomodoro History */}
          <div className="glass-panel rounded-xl p-4 flex items-center justify-between h-auto flex-none">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${isBreak ? 'bg-green-500/10 border-green-500/20' : 'bg-primary/10 border-primary/20'}`}>
                <span className={`material-symbols-outlined text-[20px] ${isBreak ? 'text-green-400' : 'text-primary'}`}>timer</span>
              </div>
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-0.5">Session</p>
                <p className="text-sm text-slate-100 font-medium">{isActive ? (isBreak ? 'Break' : 'In progress') : timeLeft === currentPreset.seconds ? 'Not started' : 'Paused'}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {todayCount > 0 && (
                <div className="text-center">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-0.5">Today</p>
                  <p className="text-sm font-bold text-slate-100">
                    {todayCount} session{todayCount !== 1 ? 's' : ''}{streak > 1 ? ` 🔥${streak}` : ''}
                  </p>
                </div>
              )}
              <div className="text-right">
                <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-0.5">Remaining</p>
                <p className={`text-sm font-mono font-bold ${isActive ? (isBreak ? 'text-green-400' : 'text-primary') : 'text-slate-400'}`}>{formatTime(timeLeft)}</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
