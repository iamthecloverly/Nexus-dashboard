import React, { useState, useEffect, useRef, useMemo } from 'react';
import { format, parseISO, isBefore, isAfter } from 'date-fns';

import { Task } from '../App';
import { useTaskContext } from '../contexts/TaskContext';
import { useEmailContext } from '../contexts/EmailContext';
import { CalendarEvent } from '../types/calendar';
import { useToast } from '../components/Toast';

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

const KEYBOARD_SHORTCUTS = [['C', 'Compose'], ['E', 'Archive'], ['Esc', 'Close'], ['↑↓', 'Navigate']] as const;

function githubTypeIcon(type: string): string {
  if (type === 'PullRequest') return 'merge';
  if (type === 'Issue') return 'bug_report';
  if (type === 'Release') return 'new_releases';
  return 'notifications';
}

export default function MainHub({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { state: { tasks }, actions: { toggleTask, addTask, deleteTask, updateTask, clearCompletedTasks } } = useTaskContext();
  const { state: { emails, gmailConnected } } = useEmailContext();
  const { showToast } = useToast();
  const [currentTime, setCurrentTime] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(true);
  const [isCalendarConnected, setIsCalendarConnected] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  // Checklist
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => {
    try {
      const saved = localStorage.getItem('dashboard_checklist');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [checklistTitle, setChecklistTitle] = useState(() =>
    localStorage.getItem(CHECKLIST_TITLE_KEY) ?? DEFAULT_CHECKLIST_TITLE
  );
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

  // Calendar context menu
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);

  // Task inline edit
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [showTaskMenu, setShowTaskMenu] = useState(false);
  const taskMenuRef = useRef<HTMLDivElement>(null);

  // FAB quick-add
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [quickAddTitle, setQuickAddTitle] = useState('');
  const [quickAddGroup, setQuickAddGroup] = useState<'now' | 'next'>('now');
  const quickAddRef = useRef<HTMLInputElement>(null);

  const { remainingTasks, unreadEmails, unreadCount, lastUnreadEmail } = useMemo(() => {
    let remaining = 0;
    for (const t of tasks) { if (!t.completed) remaining++; }
    const unread = emails.filter(e => e.unread && !e.archived && !e.deleted);
    return { remainingTasks: remaining, unreadEmails: unread, unreadCount: unread.length, lastUnreadEmail: unread[0] ?? null };
  }, [tasks, emails]);

  // Clocks
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Calendar
  useEffect(() => { fetchEvents(); }, []);

  const fetchEvents = async () => {
    try {
      setIsLoadingEvents(true);
      setCalendarError(null);
      const res = await fetch('/api/calendar/events');
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events || []);
        setIsCalendarConnected(true);
      } else if (res.status === 401) {
        setIsCalendarConnected(false);
      } else if (res.status === 503) {
        const data = await res.json().catch(() => ({}));
        setIsCalendarConnected(true);
        setCalendarError(data.code === 'API_DISABLED' ? 'api_disabled' : 'fetch_error');
      } else {
        setIsCalendarConnected(true);
        setCalendarError('fetch_error');
      }
    } catch { setIsCalendarConnected(false); }
    finally { setIsLoadingEvents(false); }
  };


  // GitHub notifications
  useEffect(() => {
    const fetchGithub = async () => {
      try {
        const res = await fetch('/api/github/notifications');
        if (res.ok) {
          const data = await res.json();
          setGithubNotifs(data.notifications ?? []);
          setGithubConnected(true);
        } else if (res.status === 401) {
          setGithubConnected(false);
        }
      } catch { setGithubConnected(false); }
    };
    fetchGithub();
  }, []);

  // Persist checklist
  useEffect(() => {
    localStorage.setItem('dashboard_checklist', JSON.stringify(checklist));
  }, [checklist]);

  useEffect(() => {
    localStorage.setItem(CHECKLIST_TITLE_KEY, checklistTitle);
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
      setChecklist(prev => [...prev, { id: Date.now().toString(), text: newItemText.trim(), completed: false }]);
      setNewItemText('');
    }
  };

  const commitTitle = () => {
    if (titleDraft.trim()) setChecklistTitle(titleDraft.trim());
    setIsEditingTitle(false);
  };

  const handleQuickAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && quickAddTitle.trim()) {
      addTask({ id: Date.now().toString(), title: quickAddTitle.trim(), completed: false, group: quickAddGroup });
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

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (taskMenuRef.current && !taskMenuRef.current.contains(e.target as Node)) {
        setShowTaskMenu(false);
      }
      setShowCalendarMenu(false);
    };
    if (showTaskMenu || showCalendarMenu) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [showTaskMenu, showCalendarMenu]);


  const renderEvent = (event: CalendarEvent) => {
    const startTime = event.start.dateTime ? parseISO(event.start.dateTime) : parseISO(event.start.date ?? '');
    const endTime = event.end.dateTime ? parseISO(event.end.dateTime) : parseISO(event.end.date ?? '');
    const isAllDay = !event.start.dateTime;
    const isPast = isBefore(endTime, currentTime) && !isAllDay;
    const isCurrent = isBefore(startTime, currentTime) && isAfter(endTime, currentTime) && !isAllDay;

    if (isCurrent) {
      return (
        <div key={event.id} className="relative pl-8 group/event">
          <div className="absolute -left-[3px] top-1.5 w-2 h-2 rounded-full bg-primary border border-background-dark shadow-glow"></div>
          <div className="bg-primary-subtle border border-primary/25 rounded-2xl p-5 -mt-3 group-hover/event:bg-primary/10 transition-colors">
            <p className="text-[10px] text-primary mb-2 font-mono uppercase font-bold tracking-wider">
              {format(startTime, 'HH:mm')} - {format(endTime, 'HH:mm')} • In Progress
            </p>
            <p className="text-lg font-semibold text-white">{event.summary || 'Busy'}</p>
            <a href={event.htmlLink} target="_blank" rel="noreferrer" className="mt-4 text-xs text-primary/60 font-medium group-hover/event:text-primary transition-colors hover:underline block">
              View Details
            </a>
          </div>
        </div>
      );
    }
    return (
      <div key={event.id} className={`relative pl-8 ${isPast ? 'opacity-40' : ''}`}>
        <div className={`absolute -left-[3px] top-1.5 w-2 h-2 rounded-full ${isPast ? 'bg-border-glass border border-background-dark' : 'bg-surface border border-border-glass'}`}></div>
        <p className="text-[10px] text-text-muted mb-1 font-mono uppercase">
          {isAllDay ? 'All Day' : `${format(startTime, 'HH:mm')} - ${format(endTime, 'HH:mm')}`}
        </p>
        <p className={`text-base font-medium ${isPast ? 'text-white/80 line-through' : 'text-white/90'}`}>
          {event.summary || 'Busy'}
        </p>
      </div>
    );
  };

  return (
    <div className="relative z-10 flex flex-col flex-1 h-screen overflow-hidden px-8 py-10 max-w-[1440px] mx-auto w-full">
      <header className="flex justify-between items-end mb-8 flex-shrink-0">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-white font-heading tracking-tight drop-shadow-lg leading-none" style={{ fontSize: 'clamp(3rem,6vw,4.5rem)' }}>
            {format(currentTime, 'HH:mm')}
            <span className="text-primary/40 ml-1 text-[40%]">{format(currentTime, 'ss')}</span>
          </h1>
          <p className="text-text-muted text-sm font-medium tracking-[0.2em] uppercase">{format(currentTime, 'EEEE, MMMM dd')}</p>
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
              <h2 className="font-heading text-xl text-white flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">event_note</span>
                Schedule
              </h2>
              <div className="flex items-center gap-1">
                <button onClick={fetchEvents} aria-label="Refresh calendar" className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:text-primary hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className="material-symbols-outlined !text-sm" aria-hidden="true">refresh</span></button>
                <div className="relative">
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
            <div className="relative flex-1 flex flex-col gap-8 pl-6">
              <div className="absolute left-1 top-2 bottom-0 w-[1px] bg-border-glass">
                <div className="absolute top-[38%] -left-[3.5px] w-2 h-10 bg-primary rounded-full shadow-glow"></div>
              </div>
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
            {tasks.filter(t => !t.completed).length === 0 && tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 opacity-60">
                <span className="material-symbols-outlined text-3xl text-text-muted">task_alt</span>
                <p className="text-sm text-text-muted">No tasks yet.<br/>Click + to add one.</p>
              </div>
            ) : (
            <div className="flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar">
              {tasks.filter(t => !t.completed).map(task => (
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
              {tasks.some(t => t.completed) && (
                <div className="mt-4 pt-4 border-t border-border-glass">
                  {tasks.filter(t => t.completed).map(task => (
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
    </div>
  );
}
