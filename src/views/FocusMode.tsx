import React, { useState, useEffect, useMemo } from 'react';
import { format, parseISO, isBefore, isAfter } from 'date-fns';

import { Task } from '../App';
import { useTaskContext } from '../contexts/TaskContext';
import { CalendarEvent } from '../types/calendar';
import { useCalendarEvents } from '../hooks/useCalendarEvents';

export default function FocusMode({ setCurrentView }: { setCurrentView: (view: string) => void }) {
  const { state: { tasks }, actions: { toggleTask, addTask, deleteTask, updateTask } } = useTaskContext();
  const [timeLeft, setTimeLeft] = useState(25 * 60); // 25 minutes
  const [isActive, setIsActive] = useState(false);

  const { events, isLoading: isLoadingEvents, isConnected: isCalendarConnected, error: calendarError } = useCalendarEvents();
  const [currentTime, setCurrentTime] = useState(new Date());

  // Tick + completion in one effect — stops the timer inside the updater
  // rather than reacting to timeLeft in a second effect (avoids an extra render cycle)
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { setIsActive(false); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 10000);
    return () => clearInterval(timer);
  }, []);

  const toggleTimer = () => setIsActive(!isActive);
  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(25 * 60);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

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

  const getEventTimes = (event: CalendarEvent) => {
    const startTime = event.start.dateTime
      ? parseISO(event.start.dateTime)
      : parseISO(event.start.date ?? '');
    const endTime = event.end.dateTime
      ? parseISO(event.end.dateTime)
      : parseISO(event.end.date ?? '');
    return { startTime, endTime };
  };

  const renderTimelineEvent = (event: CalendarEvent) => {
    const { startTime, endTime } = getEventTimes(event);
    const isAllDay = !event.start.dateTime;
    const isPast = !isAllDay && isBefore(endTime, currentTime);
    const isCurrent = !isAllDay && isBefore(startTime, currentTime) && isAfter(endTime, currentTime);
    const timeLabel = isAllDay ? 'All Day' : `${format(startTime, 'h:mm a')} — ${format(endTime, 'h:mm a')}`;

    if (isCurrent) {
      return (
        <div key={event.id} className="relative pl-12 mb-12">
          <div className="absolute left-[20px] top-1.5 w-2 h-2 rounded-full bg-primary z-10 animate-ring"></div>
          <div className="text-xs text-primary mb-2 font-bold tracking-wide uppercase">In Progress</div>
          <div className="p-8 rounded-xl bg-primary/10 border-2 glow-border relative overflow-hidden group transition-colors duration-500 hover:bg-primary/[0.15]">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[100px] -mr-32 -mt-32 pointer-events-none group-hover:scale-150 transition-transform duration-700"></div>
            <div className="relative z-10">
              <h3 className="font-heading text-3xl font-bold text-white leading-tight tracking-tight neon-text-glow">{event.summary || 'Busy'}</h3>
              <p className="text-sm text-primary/80 mt-2 font-mono">{timeLabel}</p>
              <a
                href={event.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 text-xs text-primary/60 hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                View in Calendar
              </a>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div key={event.id} className={`relative pl-12 mb-12 ${isPast ? 'opacity-40' : ''}`}>
        <div className="absolute left-[20px] top-1.5 w-2 h-2 rounded-full bg-white/20 border border-white/30 z-10"></div>
        <div className="text-xs text-[#A1A1AA] mb-1 font-medium">{timeLabel}</div>
        <div className={`p-4 rounded-lg bg-white/5 border border-white/10 ${!isPast ? 'glass-panel-hover cursor-pointer group' : ''}`}>
          <h3 className={`font-medium text-slate-100 ${!isPast ? 'group-hover:text-white transition-colors' : ''}`}>
            {event.summary || 'Busy'}
          </h3>
        </div>
      </div>
    );
  };

  // Insert current-time indicator between past and upcoming events
  const renderTimeline = () => {
    if (isLoadingEvents) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"></div>
        </div>
      );
    }
    if (!isCalendarConnected) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-4">
          <span className="material-symbols-outlined text-4xl text-[#A1A1AA]">calendar_today</span>
          <p className="text-sm text-[#A1A1AA]">Connect your Google Calendar to see your schedule.</p>
          <button onClick={() => setCurrentView('Integrations')} className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-medium text-white transition-colors border border-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
            Go to Integrations
          </button>
        </div>
      );
    }
    if (calendarError === 'api_disabled') {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <span className="material-symbols-outlined text-4xl text-accent">warning</span>
          <p className="text-sm text-white font-medium">Google Calendar API not enabled</p>
          <p className="text-xs text-[#A1A1AA] max-w-[280px]">Enable it in your Google Cloud project, then reconnect.</p>
          <a href="https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview" target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-primary/10 hover:bg-primary/20 text-xs font-medium text-primary transition-colors border border-primary/20">
            Enable Calendar API →
          </a>
        </div>
      );
    }

    const pastEvents: CalendarEvent[] = [];
    const upcomingEvents: CalendarEvent[] = [];
    for (const e of [...events].sort((a, b) => (a.start.dateTime ?? a.start.date ?? '').localeCompare(b.start.dateTime ?? b.start.date ?? ''))) {
      const isPast = !!e.start.dateTime && isBefore(getEventTimes(e).endTime, currentTime);
      (isPast ? pastEvents : upcomingEvents).push(e);
    }

    const hasInsertedIndicator = upcomingEvents.length > 0 || pastEvents.length > 0;

    return (
      <>
        {pastEvents.map(renderTimelineEvent)}

        {hasInsertedIndicator && (
          <div className="relative pl-12 mb-8 flex items-center gap-3">
            <div className="absolute left-[16px] w-4 h-4 rounded-full bg-primary z-10 shadow-[0_0_12px_rgba(6,232,249,0.6)]"></div>
            <div className="flex-1 h-px bg-primary/40 ml-4"></div>
            <span className="text-[11px] font-bold text-primary bg-primary/10 border border-primary/30 px-2 py-1 rounded neon-text-glow shrink-0">
              {format(currentTime, 'h:mm a')}
            </span>
          </div>
        )}

        {upcomingEvents.length === 0 && pastEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <p className="text-sm text-[#A1A1AA]">No events scheduled for today.</p>
          </div>
        )}

        {upcomingEvents.map(renderTimelineEvent)}

        <div className="relative pl-12 mt-4 mb-8 opacity-40">
          <div className="absolute left-[16px] top-1 w-4 h-4 rounded-full border-2 border-dashed border-white/40 bg-transparent z-10"></div>
          <div className="text-xs text-[#A1A1AA] italic font-medium">End of scheduled day</div>
        </div>
      </>
    );
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="flex-none px-8 py-6 flex justify-between items-center z-50">
        <button onClick={() => setCurrentView('MainHub')} className="flex items-center gap-2 text-slate-400 hover:text-primary transition-[color,transform] group scale-100 hover:scale-105 active:scale-95">
          <span className="material-symbols-outlined text-xl transition-transform group-hover:-translate-x-1" aria-hidden="true">arrow_back</span>
          <span className="font-medium text-sm tracking-wide">Exit Focus</span>
        </button>
        <div className="font-heading font-semibold text-xl tracking-wider text-slate-100 opacity-80">
          FOCUS MODE
        </div>
        <div className="flex items-center gap-4">
          <div className={`glass-panel rounded-full px-5 py-2 flex items-center gap-4 border-white/20 transition-colors hover:border-primary/40 group ${isActive ? 'shadow-[0_0_15px_rgba(6,232,249,0.2)]' : ''}`}>
            <div className="flex flex-col items-center">
              <span className={`text-[10px] ${isActive ? 'text-primary' : 'text-slate-400'} font-bold uppercase tracking-tighter leading-none mb-0.5 ${isActive ? 'group-hover:animate-pulse' : ''}`}>
                {isActive ? 'Focusing' : 'Paused'}
              </span>
              <span className={`text-lg font-heading font-bold ${isActive ? 'text-white' : 'text-slate-300'} tabular-nums leading-none`}>
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

      <main className="flex-1 flex gap-6 px-8 pb-8 overflow-hidden max-w-[1800px] mx-auto w-full">
        {/* Left Column: Timeline */}
        <section className="w-3/5 h-full flex flex-col relative glass-panel rounded-xl overflow-hidden flex-none">
          <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-[#0B0C10]/80 to-transparent z-20 pointer-events-none rounded-t-xl"></div>
          <div className="p-6 pb-2 z-30 bg-[#0B0C10]/40 backdrop-blur-md border-b border-white/5">
            <h2 className="font-heading text-2xl font-semibold text-slate-100">Timeline</h2>
            <p className="text-xs text-[#A1A1AA] uppercase tracking-widest mt-1 font-semibold">Today</p>
          </div>
          <div className="flex-1 overflow-y-auto relative px-6 py-12">
            <div className="timeline-line"></div>
            {renderTimeline()}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-[#0B0C10]/80 to-transparent z-20 pointer-events-none rounded-b-xl"></div>
        </section>

        {/* Right Column: Tasks */}
        <section className="w-2/5 h-full flex flex-col gap-6 flex-none">
          <div className="glass-panel rounded-xl flex-1 flex flex-col overflow-hidden relative transition-colors duration-300 hover:border-white/20">
            <div className="p-6 pb-4 z-30 bg-[#0B0C10]/40 backdrop-blur-md border-b border-white/5">
              <div className="flex justify-between items-start mb-6">
                <div>
                  <h2 className="font-heading text-2xl font-semibold text-slate-100">Action Items</h2>
                  <p className="text-xs text-[#A1A1AA] mt-1 font-medium transition-opacity" id="task-status">{remainingTasks} tasks remaining</p>
                </div>
              </div>

              <div className="relative group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                  <span className="material-symbols-outlined text-primary/60 text-[20px] group-focus-within:text-primary transition-colors" aria-hidden="true">add_circle</span>
                </div>
                <input
                  aria-label="Add a task"
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
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>
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
                          <p className="text-xs text-[#A1A1AA] mt-1 line-clamp-1">{task.description}</p>
                        )}
                      </div>
                      {task.priority && !task.completed && (
                        <span className="px-2 py-0.5 rounded text-[10px] bg-red-500/20 text-red-200 border border-red-500/20 flex-shrink-0">{task.priority}</span>
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
                          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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
                          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-accent hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
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

          {/* Session Info */}
          <div className="glass-panel rounded-xl p-4 flex items-center justify-between h-auto flex-none">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
                <span className="material-symbols-outlined text-primary text-[20px]">timer</span>
              </div>
              <div>
                <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-0.5">Session</p>
                <p className="text-sm text-slate-100 font-medium">{isActive ? 'In progress' : timeLeft === 25 * 60 ? 'Not started' : 'Paused'}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-text-muted uppercase tracking-wider font-bold mb-0.5">Remaining</p>
              <p className={`text-sm font-mono font-bold ${isActive ? 'text-primary' : 'text-slate-400'}`}>{formatTime(timeLeft)}</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
