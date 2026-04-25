import React, { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { AppShell } from './components/layout/AppShell';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { TaskProvider } from './contexts/TaskProvider';
import { useTaskContext } from './contexts/taskContext';
import { EmailProvider } from './contexts/EmailProvider';
import { useEmailContext } from './contexts/emailContext';
import MainHub from './views/MainHub';
import FocusMode from './views/FocusMode';
import Communications from './views/Communications';
import Integrations from './views/Integrations';
import Settings from './views/Settings';
import { Login } from './views/Login';
import { useAutoEmailTasks } from './hooks/useAutoEmailTasks';
import { STORAGE_KEYS } from './constants/storageKeys';
import { YouTubeAudioPlayer } from './components/youtube/YouTubeAudioPlayer';
import { extractYouTubeVideoId } from './components/youtube/youtube';
import { MusicPanel } from './components/youtube/MusicPanel';
import { preloadYouTubeIFrameApi } from './components/youtube/useYouTubeIFrameApi';
import { MOBILE_BOTTOM_NAV_HEIGHT_PX, type ViewId } from './config/navigation';
import { DesktopOnlyNotice } from './components/DesktopOnlyNotice';
import { SystemMetricsProvider } from './contexts/SystemMetricsProvider';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useViewportDesktopGate } from './hooks/useViewportDesktopGate';
import { CommandPalette, useCommandPaletteShortcut } from './components/CommandPalette';

/** Mounts the auto email→task hook inside the provider tree. Renders nothing. */
function AutoEmailTaskProcessor() {
  useAutoEmailTasks();
  return null;
}

/**
 * Bridge that reads `addTask` from within the TaskProvider tree and passes it
 * up to the parent AppContent via the provided callback ref.
 */
function AddTaskBridge({ onReady }: { onReady: (fn: (title: string) => void) => void }) {
  const { actions: { addTask } } = useTaskContext();
  useLayoutEffect(() => { onReady(addTask); }, [addTask, onReady]);
  return null;
}

/**
 * Bridge that reads email actions from within the EmailProvider tree and passes
 * them up to the parent AppContent via the provided callback ref.
 */
function EmailActionsBridge({ onReady }: { onReady: (actions: { markAllRead: () => void }) => void }) {
  const { actions } = useEmailContext();
  useLayoutEffect(() => { onReady({ markAllRead: actions.markAllRead }); }, [actions.markAllRead, onReady]);
  return null;
}

function AppContent() {
  const { showToast } = useToast();
  const isLg = useMediaQuery('(min-width: 1024px)');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewId>('MainHub');
  const [unlocked, setUnlocked] = useState(false);
  // Trigger counters — incrementing signals the target view to perform an action
  const [quickAddTrigger, setQuickAddTrigger] = useState(0);
  const [composeTrigger, setComposeTrigger] = useState(0);
  const [calendarRefreshTrigger, setCalendarRefreshTrigger] = useState(0);
  const [ytVideoId, setYtVideoId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.ytVideoId) ?? null);
  const [showMusicInput, setShowMusicInput] = useState(false);
  const [musicPlayerVisible, setMusicPlayerVisible] = useState(true);
  const [ytVolume, setYtVolume] = useState<number>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.ytVolume);
    const n = raw ? Number(raw) : 80;
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 80;
  });
  const [resumeEnabled, setResumeEnabled] = useState<boolean>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.ytResumeEnabled);
    return raw ? raw === '1' : true;
  });
  const [videoTitles, setVideoTitles] = useState<Record<string, string>>({});

  const [ytPositions, setYtPositions] = useState<Record<string, number>>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ytPositions);
      const parsed = raw ? JSON.parse(raw) : {};
      if (!parsed || typeof parsed !== 'object') return {};
      const out: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) out[k] = v;
      }
      return out;
    } catch {
      return {};
    }
  });

  const handleYtLoad = useCallback((id: string) => {
    setYtVideoId(id);
    try { localStorage.setItem(STORAGE_KEYS.ytVideoId, id); } catch { /* quota exceeded */ }
    setShowMusicInput(false);
    setMusicPlayerVisible(true);
  }, []);

  const handleYtRequestLoad = useCallback((input: string) => {
    const id = extractYouTubeVideoId(input);
    if (!id) {
      showToast('Paste a valid YouTube link or 11‑character video ID', 'error');
      return;
    }
    handleYtLoad(id);
  }, [handleYtLoad, showToast]);

  const handleYtClose = () => {
    setYtVideoId(null);
    localStorage.removeItem(STORAGE_KEYS.ytVideoId);
  };

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.ytVolume, String(ytVolume)); } catch { /* quota exceeded */ }
  }, [ytVolume]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.ytResumeEnabled, resumeEnabled ? '1' : '0'); } catch { /* quota exceeded */ }
  }, [resumeEnabled]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.ytPositions, JSON.stringify(ytPositions)); } catch { /* quota exceeded */ }
  }, [ytPositions]);

  const savePosition = useCallback((videoId: string, seconds: number) => {
    setYtPositions(prev => {
      if (Math.abs((prev[videoId] ?? 0) - seconds) < 1) return prev;
      return { ...prev, [videoId]: seconds };
    });
  }, []);

  const ytBottomOffsetPx =
    currentView === 'MainHub'
      ? (isLg ? 96 : MOBILE_BOTTOM_NAV_HEIGHT_PX + 96)
      : (isLg ? 24 : MOBILE_BOTTOM_NAV_HEIGHT_PX + 24);

  const toggleMusicChrome = useCallback(() => {
    if (ytVideoId) setMusicPlayerVisible(v => !v);
    else setShowMusicInput(v => !v);
  }, [ytVideoId]);

  // addTask ref — populated by AddTaskBridge (which lives inside TaskProvider)
  const addTaskRef = useRef<((title: string) => void) | null>(null);
  // markAllRead ref — populated by EmailActionsBridge (which lives inside EmailProvider)
  const markAllReadRef = useRef<(() => void) | null>(null);

  const handlePaletteOpenQuickAdd = useCallback(() => {
    setCurrentView('MainHub');
    setQuickAddTrigger(n => n + 1);
  }, []);

  const handlePaletteComposeEmail = useCallback(() => {
    setCurrentView('Communications');
    setComposeTrigger(n => n + 1);
  }, []);

  const handlePaletteRefreshCalendar = useCallback(() => {
    setCurrentView('MainHub');
    setCalendarRefreshTrigger(n => n + 1);
  }, []);

  const handlePaletteAddTask = useCallback((title: string) => {
    if (addTaskRef.current) {
      addTaskRef.current(title);
      showToast(`Task "${title}" added`, 'success');
    }
  }, [showToast]);

  useCommandPaletteShortcut(() => setCommandPaletteOpen(o => !o));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/session/status');
        if (!res.ok) return;
        const json = (await res.json()) as { loggedIn?: boolean };
        if (!cancelled) setUnlocked(!!json.loggedIn);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!unlocked) {
    return <Login onAuthed={() => setUnlocked(true)} />;
  }

  return (
    <>
      <TaskProvider>
        <EmailProvider>
          <AutoEmailTaskProcessor />
          <AddTaskBridge onReady={fn => { addTaskRef.current = fn; }} />
          <EmailActionsBridge onReady={actions => { markAllReadRef.current = actions.markAllRead; }} />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[999] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Skip to content
          </a>
          <div id="main-content" className="h-screen w-full bg-background-dark text-foreground overflow-hidden flex flex-col selection:bg-primary/30 selection:text-white font-sans relative">
            {/* Ambient background */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
              {/* Sky halo — top-left */}
              <div className="absolute top-[-15%] left-[-8%] w-[55%] h-[55%] rounded-full blur-[130px]" style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.16) 0%, transparent 70%)' }} />
              {/* Violet halo — bottom-right */}
              <div className="absolute bottom-[-20%] right-[-8%] w-[55%] h-[65%] rounded-full blur-[150px]" style={{ background: 'radial-gradient(circle, rgba(167,139,250,0.14) 0%, transparent 72%)' }} />
              {/* Cool lift — center */}
              <div className="absolute top-[30%] left-[35%] w-[40%] h-[40%] rounded-full blur-[120px]" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)' }} />
              {/* Subtle noise grain overlay */}
              <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'1\'/%3E%3C/svg%3E")', backgroundSize: '256px 256px' }} />
            </div>

            <AppShell
              desktopNav={isLg}
              currentView={currentView}
              setCurrentView={setCurrentView}
              onOpenMusic={toggleMusicChrome}
              onPreloadMusic={() => preloadYouTubeIFrameApi()}
              musicActive={!!ytVideoId}
            >
              <YouTubeAudioPlayer
                videoId={ytVideoId}
                visible={musicPlayerVisible}
                volume={ytVolume}
                resumeEnabled={resumeEnabled}
                savedPositions={ytPositions}
                onSavePosition={savePosition}
                bottomOffsetPx={ytBottomOffsetPx}
                onClose={handleYtClose}
                onToggleVisible={() => setMusicPlayerVisible(v => !v)}
                onVolumeChange={setYtVolume}
                onRequestLoad={handleYtRequestLoad}
                onMetaLoaded={(id, title, author) =>
                  setVideoTitles(prev => ({ ...prev, [id]: title + (author ? ` · ${author}` : '') }))
                }
              />

              <MusicPanel
                open={showMusicInput && !ytVideoId}
                onClose={() => setShowMusicInput(false)}
                onLoadVideoId={handleYtLoad}
                videoTitles={videoTitles}
              />

              {currentView === 'MainHub' && (
                <ErrorBoundary label="Main Hub">
                  <MainHub
                    setCurrentView={setCurrentView}
                    externalQuickAddTrigger={quickAddTrigger}
                    externalCalendarRefreshTrigger={calendarRefreshTrigger}
                  />
                </ErrorBoundary>
              )}
              {currentView === 'FocusMode' && <ErrorBoundary label="Focus Mode"><FocusMode setCurrentView={setCurrentView} /></ErrorBoundary>}
              {currentView === 'Communications' && (
                <ErrorBoundary label="Communications">
                  <Communications
                    setCurrentView={setCurrentView}
                    externalComposeTrigger={composeTrigger}
                  />
                </ErrorBoundary>
              )}
              {currentView === 'Integrations' && <ErrorBoundary label="Integrations"><Integrations setCurrentView={setCurrentView} /></ErrorBoundary>}
              {currentView === 'Settings' && (
                <ErrorBoundary label="Settings">
                  <Settings
                    setCurrentView={setCurrentView}
                    resumeEnabled={resumeEnabled}
                    onResumeEnabledChange={setResumeEnabled}
                    onClearMusicSession={() => {
                      setYtVideoId(null);
                      localStorage.removeItem(STORAGE_KEYS.ytVideoId);
                    }}
                  />
                </ErrorBoundary>
              )}
            </AppShell>

            <footer
              className="hidden lg:flex fixed right-0 z-[40] items-center justify-center pointer-events-none"
              style={{
                left: 'calc(var(--app-nav-width, 0px) + 0.75rem)',
                bottom: '1rem',
              }}
              aria-label="Footer"
            >
              <div className="pointer-events-auto text-[11px] text-white/30">
                Made with love ❤️ by{' '}
                <a
                  href="https://linkedin.com/in/thecloverly"
                  target="_blank"
                  rel="noreferrer"
                  className="text-white/55 hover:text-white/80 underline underline-offset-2 decoration-white/15 hover:decoration-white/35 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                >
                  Sribalaji
                </a>
              </div>
            </footer>

            <CommandPalette
              open={commandPaletteOpen}
              onClose={() => setCommandPaletteOpen(false)}
              setCurrentView={setCurrentView}
              onToggleMusic={toggleMusicChrome}
              onOpenQuickAdd={handlePaletteOpenQuickAdd}
              onComposeEmail={handlePaletteComposeEmail}
              onMarkAllRead={() => markAllReadRef.current?.()}
              onRefreshCalendar={handlePaletteRefreshCalendar}
              onAddTask={handlePaletteAddTask}
            />
          </div>
        </EmailProvider>
      </TaskProvider>
    </>
  );
}

function ViewportGate({ children }: { children: React.ReactNode }) {
  const needsDesktop = useViewportDesktopGate();
  if (needsDesktop) return <DesktopOnlyNotice />;
  return <>{children}</>;
}

export default function App() {
  return (
    <ToastProvider>
      <SystemMetricsProvider>
        <ViewportGate>
          <AppContent />
        </ViewportGate>
      </SystemMetricsProvider>
    </ToastProvider>
  );
}
