import React, { useState, useEffect, useRef, useMemo } from 'react';
import { format, parseISO, isBefore, isAfter } from 'date-fns';

import { Task } from '../App';
import { useTaskContext } from '../contexts/TaskContext';
import { useEmailContext } from '../contexts/EmailContext';
import { CalendarEvent } from '../types/calendar';
import { useToast } from '../components/Toast';
import { useCalendarEvents } from '../hooks/useCalendarEvents';

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
  return (
    <>
      <h1 className="text-white font-heading tracking-tight drop-shadow-lg leading-none" style={{ fontSize: 'clamp(3rem,6vw,4.5rem)' }}>
        {format(now, 'HH:mm')}
        <span className="text-primary/40 ml-1 text-[40%]">{format(now, 'ss')}</span>
      </h1>
      <p className="text-text-muted text-sm font-medium tracking-[0.2em] uppercase">{format(now, 'EEEE, MMMM dd')}</p>
    </>
  );
}

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
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

const CHECKLIST_TITLE_KEY = 'dashboard_checklist_title';
const DEFAULT_CHECKLIST_TITLE = 'My Checklist';

function githubTypeIcon(type: string): string {
  if (type === 'PullRequest') return 'merge';
  if (type === 'Issue') return 'bug_report';
  if (type === 'Release') return 'new_releases';
  return 'notifications';
}

export default function MainHub({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { state: { tasks }, actions: { toggleTask, addTask, deleteTask, updateTask, clearCompletedTasks } } = useTaskContext();
  const { state: { emails, gmailConnected, serverError: gmailServerError } } = useEmailContext();
  const { showToast } = useToast();
  const [currentTime, setCurrentTime] = useState(new Date());
  const { events, isLoading: isLoadingEvents, isConnected: isCalendarConnected, error: calendarError, refetch: fetchEvents } = useCalendarEvents();

  // Checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => {
    try {
      const saved = localStorage.getItem('dashboard_checklist');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [checklistTitle, setChecklistTitle] = useState(() => {
    try { return localStorage.getItem(CHECKLIST_TITLE_KEY) ?? DEFAULT_CHECKLIST_TITLE; }
    catch { return DEFAULT_CHECKLIST_TITLE; }
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [newItemText, setNewItemText] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newItemRef = useRef<HTMLInputElement>(null);


  // GitHub
  const [githubNotifs, setGithubNotifs] = useState<GithubNotification[]>([]);
  const [githubConnected, setGithubConnected] = useState(false);

  // Onboarding banner
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('dashboard_onboarding_dismissed'));

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

  // currentTime used only for event isCurrent/isPast — 10s is sufficient precision
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);

  // GitHub notifications — poll every 5 minutes
  useEffect(() => {
    const fetchGithub = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch('/api/github/notifications', { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          setGithubNotifs(data.notifications ?? []);
          setGithubConnected(true);
        } else if (res.status === 401) {
          setGithubConnected(false);
        }
      } catch { clearTimeout(timeoutId); setGithubConnected(false); }
    };
    fetchGithub();
    const interval = setInterval(fetchGithub, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Persist checklist
  useEffect(() => {
    try { localStorage.setItem('dashboard_checklist', JSON.stringify(checklist)); } catch { /* quota exceeded */ }
  }, [checklist]);

  useEffect(() => {
    try { localStorage.setItem(CHECKLIST_TITLE_KEY, checklistTitle); } catch { /* quota exceeded */ }
  }, [checklistTitle]);

  const toggleChecklistItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChecklist(prev => prev.map(item => item.id === id ? { ...item, completed: !item.completed } : item));
  };

  const deleteChecklistItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setChecklist(prev => prev.filter(item => item.id !== id));
  };

  const addChecklistItem = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && newItemText.trim()) {
      setChecklist(prev => [...prev, { id: crypto.randomUUID(), text: newItemText.trim(), completed: false }]);
      setNewItemText('');
    }
  };

  const commitTitle = () => {
    if (titleDraft.trim()) setChecklistTitle(titleDraft.trim());
    setIsEditingTitle(false);
  };

  const handleQuickAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && quickAddTitle.trim()) {
      addTask({ id: crypto.randomUUID(), title: quickAddTitle.trim(), completed: false, group: quickAddGroup });
      showToast('Task added', 'success');
      setQuickAddTitle('');
      setShowQuickAdd(false);
    }
    if (e.key === 'Escape') { setQuickAddTitle(''); setShowQuickAdd(false); }
  };

  const commitTaskEdit = (id: string) => {
    if (editingTaskTitle.trim()) updateTask(id, { title: editingTaskTitle.trim() });
    setEditingTaskId(null);
  };

  // Close task menu on outside click
  useEffect(() => {
    if (!showTaskMenu) return;
    const handler = (e: MouseEvent) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(e.target as Node)) setShowTaskMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTaskMenu]);

  // Close calendar menu on outside click
  useEffect(() => {
    if (!showCalendarMenu) return;
    const handler = (e: MouseEvent) => {
      if (calendarMenuRef.current && !calendarMenuRef.current.contains(e.target as Node)) setShowCalendarMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showCalendarMenu]);

  // Close full-screen schedule on Escape
  useEffect(() => {
    if (!showSchedule) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSchedule(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showSchedule]);

  const renderEvent = (event: CalendarEvent) => {
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
            : `${format(startTime, 'HH:mm')} – ${format(endTime, 'HH:mm')}${isCurrent ? ' • Now' : ''}`}
        </p>
        {/* Event title */}
        <p className={`text-sm font-semibold leading-snug ${isPast ? 'text-white/50' : 'text-white'}`}>
          {event.summary || 'Busy'}
        </p>
      </div>
    );
  };

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
            <p className="text-sm font-semibold text-white mb-1">Welcome to your dashboard!</p>
            <p className="text-xs text-text-muted">Get started by connecting your Google account for Calendar &amp; Gmail, or hit <span className="text-primary font-mono">+</span> to add your first task.</p>
            <button onClick={() => setCurrentView('Integrations')} className="mt-2 text-xs text-primary hover:underline font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
              Connect integrations
            </button>
          </div>
          <button
            onClick={() => { localStorage.setItem('dashboard_onboarding_dismissed', '1'); setShowOnboarding(false); }}
            aria-label="Dismiss welcome banner"
            className="text-text-muted hover:text-white transition-colors flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
          >
            <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
          </button>
        </div>
      )}

      <main className="flex-1 overflow-y-auto pr-4 pb-12 custom-scrollbar">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 auto-rows-[minmax(200px,_auto)]">

          {/* Calendar Widget */}
          <div className="glass-panel col-span-1 md:col-span-2 row-span-2 p-8 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-primary/80 via-primary/30 to-transparent pointer-events-none"></div>
            <div className="flex justify-between items-center mb-8">
              <button
                onClick={() => setShowSchedule(true)}
                className="font-heading text-xl text-white flex items-center gap-3 hover:text-primary transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
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
                        className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined !text-sm">refresh</span>
                        Refresh
                      </button>
                      <button
                        onClick={() => { setShowSchedule(true); setShowCalendarMenu(false); }}
                        className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined !text-sm">open_in_full</span>
                        Full schedule
                      </button>
                      <a
                        href="https://calendar.google.com"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => setShowCalendarMenu(false)}
                        className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
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
                  className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary-subtle px-4 py-1.5 rounded-full hover:bg-primary/20 transition-all border border-primary/20 btn-interact"
                >
                  Focus Mode
                </button>
              </div>
            </div>
            <div className="relative flex-1 flex flex-col gap-7 pl-6">
              <div className="absolute left-1 top-2 bottom-0 w-[1px] bg-border-glass" />
              {isLoadingEvents ? (
                <div className="flex items-center justify-center h-full">
                  <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
                </div>
              ) : !isCalendarConnected ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4">
                  <span className="material-symbols-outlined text-4xl text-text-muted">calendar_today</span>
                  <p className="text-sm text-text-muted">Connect your Google Calendar to see your schedule.</p>
                  <button onClick={() => setCurrentView('Integrations')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-all border border-white/10">
                    Go to Integrations
                  </button>
                </div>
              ) : calendarError === 'api_disabled' ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <span className="material-symbols-outlined text-4xl text-accent">warning</span>
                  <p className="text-sm text-white font-medium">Google Calendar API not enabled</p>
                  <p className="text-xs text-text-muted max-w-[260px]">Enable it in your Google Cloud project, then reconnect.</p>
                  <a
                    href="https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-xs font-medium text-primary transition-all border border-primary/20"
                  >
                    Enable Calendar API →
                  </a>
                </div>
              ) : calendarError === 'fetch_error' ? (
                <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <span className="material-symbols-outlined text-3xl text-text-muted">sync_problem</span>
                  <p className="text-sm text-text-muted">Failed to load events.</p>
                  <button onClick={fetchEvents} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white border border-white/10 transition-all">Retry</button>
                </div>
              ) : events.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-text-muted">No events today.</p>
                </div>
              ) : events.map(renderEvent)}
            </div>
          </div>

          {/* Tasks */}
          <div className="glass-panel col-span-1 row-span-2 p-7 flex flex-col relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-green-400/70 via-green-400/20 to-transparent pointer-events-none"></div>
            <div className="flex justify-between items-center mb-8">
              <h2 className="font-heading text-lg text-white flex items-center gap-3">
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
                  className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-white hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="material-symbols-outlined !text-sm" aria-hidden="true">more_vert</span>
                </button>
                {showTaskMenu && (
                  <div className="absolute top-16 right-6 z-50 glass-panel rounded-lg overflow-hidden border border-white/10 shadow-xl min-w-[160px]">
                    <button
                      onClick={() => { clearCompletedTasks(); setShowTaskMenu(false); showToast('Completed tasks cleared', 'info'); }}
                      className="w-full text-left px-4 py-2.5 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors flex items-center gap-2"
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
              {activeTasks.map(task => (
                <div key={task.id} className="group/task flex items-start gap-3 p-3 rounded-xl hover:bg-surface-hover transition-all border border-transparent hover:border-border-glass">
                  <button
                    onClick={() => toggleTask(task.id)}
                    role="checkbox"
                    aria-checked={task.completed}
                    aria-label={task.title}
                    className={`mt-1 w-5 h-5 rounded-md border-2 flex-shrink-0 relative transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${task.priority === 'Critical' ? 'border-accent/50 group-hover/task:border-accent' : 'border-border-glass group-hover/task:border-primary/50'}`}
                  >
                    {task.priority === 'Critical' && <div className="absolute inset-1 bg-accent rounded-sm"></div>}
                  </button>
                  <div className="flex flex-col flex-1 min-w-0">
                    {editingTaskId === task.id ? (
                      <input
                        autoFocus
                        className="bg-white/5 border border-primary/40 rounded px-2 py-0.5 text-sm text-white focus:outline-none w-full"
                        value={editingTaskTitle}
                        onChange={e => setEditingTaskTitle(e.target.value)}
                        onBlur={() => commitTaskEdit(task.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitTaskEdit(task.id); if (e.key === 'Escape') setEditingTaskId(null); }}
                      />
                    ) : (
                      <span
                        onClick={() => { setEditingTaskId(task.id); setEditingTaskTitle(task.title); }}
                        className={`text-sm font-medium text-white cursor-text transition-colors ${task.priority === 'Critical' ? 'group-hover/task:text-accent' : 'group-hover/task:text-primary'}`}
                      >{task.title}</span>
                    )}
                    {task.priority && (
                      <span className={`text-[10px] mt-1 uppercase ${task.priority === 'Critical' ? 'text-accent font-bold' : task.priority === 'Priority' ? 'text-primary font-bold tracking-tighter' : 'text-text-muted'}`}>{task.priority}</span>
                    )}
                  </div>
                  <button
                    onClick={() => deleteTask(task.id)}
                    aria-label={`Delete task: ${task.title}`}
                    className="opacity-0 group-hover/task:opacity-100 transition-opacity text-text-muted hover:text-accent flex-shrink-0 mt-0.5 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                  >
                    <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                  </button>
                </div>
              ))}
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
                <span className="relative inline-flex rounded-full h-2 w-2 bg-accent shadow-[0_0_10px_#FF0055]"></span>
              </div>
            )}
            <h2 className="font-heading text-lg text-white mb-auto flex items-center gap-3">
              <span className="material-symbols-outlined text-text-muted text-[22px]">mark_email_unread</span>
              Triage
            </h2>
            <div className="mt-4">
              {gmailConnected ? (
                <>
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-4xl font-heading text-white">{unreadCount}</span>
                    <span className="text-xs text-text-muted font-medium uppercase tracking-widest">New</span>
                  </div>
                  {lastUnreadEmail ? (
                    <p className="text-xs text-text-muted truncate group-hover/box:text-white transition-colors">Last from <span className="text-primary group-hover/box:font-bold">{lastUnreadEmail.sender}</span></p>
                  ) : (
                    <p className="text-xs text-text-muted">Inbox zero!</p>
                  )}
                </>
              ) : gmailServerError ? (
                <p className="text-xs text-text-muted group-hover/box:text-white transition-colors">Server unreachable.</p>
              ) : (
                <p className="text-xs text-text-muted group-hover/box:text-white transition-colors">Connect Gmail to see your inbox.</p>
              )}
            </div>
            <div className="absolute -bottom-10 -right-10 w-24 h-24 bg-primary/10 rounded-full blur-3xl group-hover/box:bg-primary/20 transition-all duration-700" aria-hidden="true"></div>
          </button>

          {/* Dynamic Checklist */}
          <div className="glass-panel col-span-1 row-span-1 p-6 flex flex-col relative group/checklist overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-violet-400/70 via-violet-400/20 to-transparent pointer-events-none"></div>
            <div className="flex justify-between items-start mb-3">
              {isEditingTitle ? (
                <input
                  ref={titleInputRef}
                  className="bg-transparent border-b border-primary/50 text-white font-heading text-lg focus:outline-none w-full mr-2"
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') setIsEditingTitle(false); }}
                />
              ) : (
                <h2 className="font-heading text-lg text-white">{checklistTitle}</h2>
              )}
              <button
                onClick={() => { setTitleDraft(checklistTitle); setIsEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 50); }}
                aria-label="Edit checklist title"
                className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-white hover:scale-110 transition-all flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
              >
                <span className="material-symbols-outlined !text-sm" aria-hidden="true">edit</span>
              </button>
            </div>
            <div className="flex flex-col gap-1 flex-1 overflow-y-auto custom-scrollbar pr-1">
              {checklist.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 py-1 text-xs group/item"
                >
                  <button
                    onClick={(e) => toggleChecklistItem(item.id, e)}
                    role="checkbox"
                    aria-checked={item.completed}
                    aria-label={item.text}
                    className={`material-symbols-outlined !text-sm cursor-pointer flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded ${item.completed ? 'text-primary' : 'text-text-muted hover:text-white'}`}
                  >
                    {item.completed ? 'check_box' : 'check_box_outline_blank'}
                  </button>
                  <span className={`flex-1 ${item.completed ? 'line-through text-text-muted opacity-60' : 'text-white'}`}>
                    {item.text}
                  </span>
                  <button
                    onClick={(e) => deleteChecklistItem(item.id, e)}
                    aria-label={`Delete: ${item.text}`}
                    className="opacity-0 group-hover/item:opacity-100 transition-opacity text-text-muted hover:text-accent focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                  >
                    <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                  </button>
                </div>
              ))}
              <input
                ref={newItemRef}
                aria-label="Add checklist item"
                className="mt-1 bg-transparent border-b border-white/10 text-xs text-white placeholder-white/20 focus-visible:outline-none focus-visible:border-primary/40 py-1 transition-colors"
                placeholder="+ Add item…"
                value={newItemText}
                onChange={e => setNewItemText(e.target.value)}
                onKeyDown={addChecklistItem}
              />
            </div>
          </div>

          {/* GitHub Notifications — only shown when connected */}
          {githubConnected && (
            <div className="glass-panel col-span-1 md:col-span-2 row-span-2 p-6 flex flex-col relative">
              <div className="flex justify-between items-center mb-5">
                <h2 className="font-heading text-lg text-white flex items-center gap-3">
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
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-surface-hover transition-all border border-transparent hover:border-border-glass group/notif"
                    >
                      <span className="material-symbols-outlined text-text-muted !text-[18px] flex-shrink-0 mt-0.5 group-hover/notif:text-primary transition-colors">{githubTypeIcon(n.type)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white/90 font-medium truncate group-hover/notif:text-white">{n.title}</p>
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
        className="fixed bottom-10 right-10 w-16 h-16 bg-primary text-[#0B0C10] rounded-2xl flex items-center justify-center shadow-[0_10px_30px_rgba(0,240,255,0.4)] hover:shadow-[0_15px_40px_rgba(0,240,255,0.6)] transition-shadow z-50 overflow-hidden group btn-interact focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      >
        <span className="material-symbols-outlined !text-[32px] !font-bold relative z-10" aria-hidden="true">add</span>
        <div className="absolute inset-0 bg-white opacity-0 group-hover:opacity-20 transition-opacity" aria-hidden="true"></div>
      </button>

      {showQuickAdd && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-10 pointer-events-none">
          <div className="glass-panel rounded-2xl p-4 w-72 pointer-events-auto shadow-2xl border border-primary/30">
            <p className="text-xs text-primary font-bold uppercase tracking-widest mb-3">Quick Add Task</p>
            <input
              ref={quickAddRef}
              aria-label="Task title"
              className="w-full bg-white/5 border border-white/10 rounded-lg py-2 px-3 text-sm text-white placeholder-white/30 focus-visible:outline-none focus-visible:border-primary/50 focus-visible:ring-1 focus-visible:ring-primary/20 transition-colors"
              placeholder="Task title… (Enter to add)"
              value={quickAddTitle}
              onChange={e => setQuickAddTitle(e.target.value)}
              onKeyDown={handleQuickAdd}
            />
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => setQuickAddGroup('now')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${quickAddGroup === 'now' ? 'bg-primary text-[#0B0C10]' : 'bg-white/5 text-text-muted hover:text-white'}`}
              >Now</button>
              <button
                onClick={() => setQuickAddGroup('next')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${quickAddGroup === 'next' ? 'bg-primary text-[#0B0C10]' : 'bg-white/5 text-text-muted hover:text-white'}`}
              >Next</button>
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
              <h2 className="font-heading text-xl text-white">Schedule</h2>
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
                className="text-[10px] font-bold uppercase tracking-widest text-primary bg-primary/10 px-4 py-1.5 rounded-full hover:bg-primary/20 transition-all border border-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                Focus Mode
              </button>
              <button
                onClick={() => setShowSchedule(false)}
                aria-label="Close schedule"
                className="ml-2 w-8 h-8 flex items-center justify-center rounded-full text-text-muted hover:text-white hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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
                {isLoadingEvents ? (
                  <div className="flex items-center justify-center py-16">
                    <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-label="Loading events" />
                  </div>
                ) : !isCalendarConnected ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                    <span className="material-symbols-outlined text-4xl text-text-muted" aria-hidden="true">calendar_today</span>
                    <p className="text-sm text-text-muted">Connect your Google Calendar to see your schedule.</p>
                    <button
                      onClick={() => { setShowSchedule(false); setCurrentView('Integrations'); }}
                      className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-all border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Go to Integrations
                    </button>
                  </div>
                ) : calendarError === 'api_disabled' ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                    <span className="material-symbols-outlined text-4xl text-accent" aria-hidden="true">warning</span>
                    <p className="text-sm text-white font-medium">Google Calendar API not enabled</p>
                    <p className="text-xs text-text-muted max-w-[260px]">Enable it in your Google Cloud project, then reconnect.</p>
                    <a
                      href="https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview"
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-xs font-medium text-primary transition-all border border-primary/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      Enable Calendar API →
                    </a>
                  </div>
                ) : calendarError === 'fetch_error' ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
                    <span className="material-symbols-outlined text-3xl text-text-muted" aria-hidden="true">sync_problem</span>
                    <p className="text-sm text-text-muted">Failed to load events.</p>
                    <button onClick={fetchEvents} className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-white border border-white/10 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">Retry</button>
                  </div>
                ) : events.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <p className="text-sm text-text-muted">No events today.</p>
                  </div>
                ) : events.map(renderEvent)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
