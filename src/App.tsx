import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { TaskProvider } from './contexts/TaskProvider';
import { EmailProvider } from './contexts/EmailProvider';
import MainHub from './views/MainHub';
import FocusMode from './views/FocusMode';
import Communications from './views/Communications';
import Integrations from './views/Integrations';
import Settings from './views/Settings';
import { useAutoEmailTasks } from './hooks/useAutoEmailTasks';
import { STORAGE_KEYS } from './constants/storageKeys';
import { YouTubeAudioPlayer } from './components/youtube/YouTubeAudioPlayer';
import { extractYouTubeVideoId } from './components/youtube/youtube';
import { MusicPanel } from './components/youtube/MusicPanel';
import { preloadYouTubeIFrameApi } from './components/youtube/useYouTubeIFrameApi';
import { useToast } from './components/Toast';

/** Mounts the auto email→task hook inside the provider tree. Renders nothing. */
function AutoEmailTaskProcessor() {
  useAutoEmailTasks();
  return null;
}

function AppContent() {
  const { showToast } = useToast();
  const [currentView, setCurrentView] = useState('MainHub');
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

  return (
    <>
      <TaskProvider>
        <EmailProvider>
          <AutoEmailTaskProcessor />
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[999] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            Skip to content
          </a>
          <div id="main-content" className="h-screen w-full bg-background-dark text-slate-200 overflow-hidden flex selection:bg-primary/30 selection:text-white font-sans relative">
            {/* Ambient background */}
            <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
              {/* Cyan halo — top-left */}
              <div className="absolute top-[-15%] left-[-8%] w-[55%] h-[55%] rounded-full blur-[130px]" style={{ background: 'radial-gradient(circle, rgba(0,217,255,0.18) 0%, transparent 70%)' }} />
              {/* Violet halo — bottom-right */}
              <div className="absolute bottom-[-20%] right-[-8%] w-[55%] h-[65%] rounded-full blur-[150px]" style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 70%)' }} />
              {/* Indigo halo — center */}
              <div className="absolute top-[30%] left-[35%] w-[40%] h-[40%] rounded-full blur-[120px]" style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%)' }} />
              {/* Subtle noise grain overlay */}
              <div className="absolute inset-0 opacity-[0.025]" style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 256 256\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'1\'/%3E%3C/svg%3E")', backgroundSize: '256px 256px' }} />
            </div>

            <Sidebar
              currentView={currentView}
              setCurrentView={setCurrentView}
              onOpenMusic={() => {
                if (ytVideoId) setMusicPlayerVisible(v => !v);
                else setShowMusicInput(v => !v);
              }}
              onPreloadMusic={() => preloadYouTubeIFrameApi()}
              musicActive={!!ytVideoId}
            />

            <YouTubeAudioPlayer
              videoId={ytVideoId}
              visible={musicPlayerVisible}
              volume={ytVolume}
              resumeEnabled={resumeEnabled}
              savedPositions={ytPositions}
              onSavePosition={savePosition}
              bottomOffsetPx={currentView === 'MainHub' ? 96 : 24}
              onClose={handleYtClose}
              onToggleVisible={() => setMusicPlayerVisible(v => !v)}
              onVolumeChange={setYtVolume}
              onRequestLoad={handleYtRequestLoad}
            />

            <MusicPanel
              open={showMusicInput && !ytVideoId}
              onClose={() => setShowMusicInput(false)}
              onLoadVideoId={handleYtLoad}
            />

            {currentView === 'MainHub' && <ErrorBoundary label="Main Hub"><MainHub setCurrentView={setCurrentView} /></ErrorBoundary>}
            {currentView === 'FocusMode' && <ErrorBoundary label="Focus Mode"><FocusMode setCurrentView={setCurrentView} /></ErrorBoundary>}
            {currentView === 'Communications' && <ErrorBoundary label="Communications"><Communications setCurrentView={setCurrentView} /></ErrorBoundary>}
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
          </div>
        </EmailProvider>
      </TaskProvider>
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}
