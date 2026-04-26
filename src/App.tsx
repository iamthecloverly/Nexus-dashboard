import React, { useState, useEffect, useCallback } from 'react';
import { AppShell } from './components/layout/AppShell';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider, useToast } from './components/Toast';
import { TaskProvider } from './contexts/TaskProvider';
import { useTaskContext } from './contexts/taskContext';
import { EmailProvider } from './contexts/EmailProvider';
import { useEmailContext } from './contexts/emailContext';
import { MusicProvider } from './contexts/MusicProvider';
import { useMusicContext } from './contexts/musicContext';
import MainHub from './views/MainHub';
import FocusMode from './views/FocusMode';
import Communications from './views/Communications';
import Integrations from './views/Integrations';
import Settings from './views/Settings';
import { Login } from './views/Login';
import { useAutoEmailTasks } from './hooks/useAutoEmailTasks';
import { YouTubeAudioPlayer } from './components/youtube/YouTubeAudioPlayer';
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

function AppAuthed({
  currentView,
  setCurrentView,
  isLg,
  quickAddTrigger,
  composeTrigger,
  calendarRefreshTrigger,
  commandPaletteOpen,
  setCommandPaletteOpen,
  handlePaletteOpenQuickAdd,
  handlePaletteComposeEmail,
  handlePaletteRefreshCalendar,
}: {
  currentView: ViewId;
  setCurrentView: React.Dispatch<React.SetStateAction<ViewId>>;
  isLg: boolean;
  quickAddTrigger: number;
  composeTrigger: number;
  calendarRefreshTrigger: number;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handlePaletteOpenQuickAdd: () => void;
  handlePaletteComposeEmail: () => void;
  handlePaletteRefreshCalendar: () => void;
}) {
  const { showToast } = useToast();
  const { actions: { addTask } } = useTaskContext();
  const { actions: { markAllRead } } = useEmailContext();
  const {
    ytVideoId,
    showMusicInput,
    musicPlayerVisible,
    ytVolume,
    resumeEnabled,
    videoTitles,
    ytPositions,
    savePosition,
    handleYtLoad,
    handleYtClose,
    handleYtRequestLoad,
    toggleMusicChrome,
    setMusicPlayerVisible,
    setYtVolume,
    setVideoTitles,
    setShowMusicInput,
  } = useMusicContext();

  const ytBottomOffsetPx =
    currentView === 'MainHub'
      ? (isLg ? 96 : MOBILE_BOTTOM_NAV_HEIGHT_PX + 96)
      : (isLg ? 24 : MOBILE_BOTTOM_NAV_HEIGHT_PX + 24);

  const handlePaletteAddTask = useCallback((title: string) => {
    addTask({ id: crypto.randomUUID(), title, completed: false, group: 'now' });
    showToast(`Task "${title}" added`, 'success');
  }, [addTask, showToast]);

  return (
    <>
      <AutoEmailTaskProcessor />
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
          onMarkAllRead={markAllRead}
          onRefreshCalendar={handlePaletteRefreshCalendar}
          onAddTask={handlePaletteAddTask}
        />
      </div>
    </>
  );
}

function AppContent() {
  const isLg = useMediaQuery('(min-width: 1024px)');
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [currentView, setCurrentView] = useState<ViewId>('MainHub');
  const [unlocked, setUnlocked] = useState(false);
  // Trigger counters — incrementing signals the target view to perform an action
  const [quickAddTrigger, setQuickAddTrigger] = useState(0);
  const [composeTrigger, setComposeTrigger] = useState(0);
  const [calendarRefreshTrigger, setCalendarRefreshTrigger] = useState(0);

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

  useCommandPaletteShortcut(() => setCommandPaletteOpen(o => !o));

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/session/status');
      if (!res.ok) return;
      const json = (await res.json()) as { loggedIn?: boolean; allowlisted?: boolean; googleEmail?: string | null };
      // Align SPA gate with server gate (requireDashboardAccess)
      setUnlocked(!!json.loggedIn && !!json.allowlisted && !!json.googleEmail);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await checkSession();
    })();
    return () => { cancelled = true; };
  }, [checkSession]);

  if (!unlocked) {
    return <Login onAuthed={() => { void checkSession(); }} />;
  }

  return (
    <TaskProvider>
      <EmailProvider>
        <MusicProvider>
          <AppAuthed
            currentView={currentView}
            setCurrentView={setCurrentView}
            isLg={isLg}
            quickAddTrigger={quickAddTrigger}
            composeTrigger={composeTrigger}
            calendarRefreshTrigger={calendarRefreshTrigger}
            commandPaletteOpen={commandPaletteOpen}
            setCommandPaletteOpen={setCommandPaletteOpen}
            handlePaletteOpenQuickAdd={handlePaletteOpenQuickAdd}
            handlePaletteComposeEmail={handlePaletteComposeEmail}
            handlePaletteRefreshCalendar={handlePaletteRefreshCalendar}
          />
        </MusicProvider>
      </EmailProvider>
    </TaskProvider>
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
