import React, { useState, useRef, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { TaskProvider } from './contexts/TaskContext';
import { EmailProvider } from './contexts/EmailContext';
import MainHub from './views/MainHub';
import FocusMode from './views/FocusMode';
import Communications from './views/Communications';
import Integrations from './views/Integrations';
import Settings from './views/Settings';
import { useAutoEmailTasks } from './hooks/useAutoEmailTasks';
import { STORAGE_KEYS } from './constants/storageKeys';

/** Mounts the auto email→task hook inside the provider tree. Renders nothing. */
function AutoEmailTaskProcessor() {
  useAutoEmailTasks();
  return null;
}

declare global {
  interface Window {
    YT: { Player: new (el: HTMLElement, config: any) => any };
    onYouTubeIframeAPIReady?: () => void;
  }
}

/** Matches YouTube video IDs from all known URL formats */
const YT_URL_RE = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([a-zA-Z0-9_-]{11})/;

function loadYTScript() {
  if (document.getElementById('yt-api-script')) return;
  const tag = document.createElement('script');
  tag.id = 'yt-api-script';
  tag.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(tag);
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function YouTubeAudioPlayer({
  videoId,
  onClose,
  onLoad,
}: {
  videoId: string | null;
  onClose: () => void;
  onLoad: (id: string) => void;
}) {
  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);

  // Load YT script once
  useEffect(() => { loadYTScript(); }, []);

  // Create / switch video when videoId changes
  useEffect(() => {
    if (!videoId) {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      return;
    }

    let active = true;

    const init = () => {
      if (!active) return;
      if (playerRef.current) {
        playerRef.current.loadVideoById(videoId);
        return;
      }
      if (!playerDivRef.current) return;
      playerRef.current = new window.YT.Player(playerDivRef.current, {
        height: '180',
        width: '320',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          rel: 0,
          modestbranding: 1,
          enablejsapi: 1,
          // Required for JS API calls (playVideo/pauseVideo) to work cross-origin
          origin: window.location.origin,
        },
        events: {
          onReady: (e: any) => {
            if (!active) return;
            e.target.setVolume(volume);
            // Don't call getDuration() here — metadata not ready yet; it returns 0
            e.target.playVideo();
          },
          onStateChange: (e: any) => {
            if (!active) return;
            // YT.PlayerState: PLAYING=1, PAUSED=2, ENDED=0, BUFFERING=3
            setPlaying(e.data === 1);
            // Read duration once playback starts (metadata guaranteed to be loaded)
            if (e.data === 1 || e.data === 3) {
              const d = e.target.getDuration();
              if (d > 0) setDuration(d);
            }
          },
        },
      });
    };

    if (window.YT?.Player) {
      init();
    } else {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); init(); };
    }

    return () => {
      active = false;
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId]);

  // Progress polling — only run while playing
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        setProgress(playerRef.current.getCurrentTime());
      }
    }, 500);
    return () => clearInterval(id);
  }, [playing]);

  // Sync volume
  useEffect(() => { playerRef.current?.setVolume?.(volume); }, [volume]);

  const togglePlay = () => {
    if (!playerRef.current) return;
    playing ? playerRef.current.pauseVideo() : playerRef.current.playVideo();
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || !duration) return;
    // Avoid layout reads; rely on offsetX within the slider track
    const native = e.nativeEvent as MouseEvent;
    const x = (native as any).offsetX as number | undefined;
    const w = e.currentTarget.clientWidth;
    if (typeof x !== 'number' || !w) return;
    const t = (x / w) * duration;
    playerRef.current.seekTo(t, true);
    setProgress(t);
  };

  const seekKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); skip(5); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); skip(-5); }
    if (e.key === 'Home') { e.preventDefault(); skip(-progress); }
    if (e.key === 'End')  { e.preventDefault(); skip(duration - progress); }
  };

  const skip = (delta: number) => {
    if (!playerRef.current) return;
    const t = Math.max(0, Math.min(duration, progress + delta));
    playerRef.current.seekTo(t, true);
    setProgress(t);
  };

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;

  return (
    <>
      {/* Off-screen hidden player — always mounted so audio never stops */}
      <div
        ref={playerDivRef}
        aria-hidden="true"
        style={{ position: 'fixed', left: -9999, top: 0, width: 320, height: 180, pointerEvents: 'none' }}
      />

      {/* Audio player UI — only shown when a video is loaded */}
      {videoId && (
        <div className="fixed bottom-6 right-6 z-[200] w-72 rounded-2xl overflow-hidden shadow-2xl border border-white/[0.08]" style={{ background: '#0C0F1E' }}>
          {/* Blurred thumbnail header */}
          <div className="relative h-14 overflow-hidden flex-shrink-0">
            {thumb && <img src={thumb} width={320} height={56} className="absolute inset-0 w-full h-full object-cover scale-110 blur-md" alt="" />}
            <div className="absolute inset-0" style={{ background: 'rgba(5,8,18,0.8)' }} />
            <div className="relative flex items-center gap-2.5 px-3 h-full">
              {thumb && <img src={thumb} width={36} height={36} className="w-9 h-9 rounded-lg object-cover flex-shrink-0 shadow-lg" alt="Video thumbnail" />}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-white/40 uppercase tracking-widest font-mono">Now Playing</p>
                <div className="flex items-end gap-[3px] h-3 mt-0.5" aria-hidden="true">
                  {[50, 80, 35, 90, 55].map((h, i) => (
                    <div
                      key={i}
                      className={`eq-bar w-[2px] rounded-full${playing ? ' eq-bar-playing' : ''}`}
                      style={{
                        height: playing ? `${h}%` : '20%',
                        background: '#00D9FF',
                        opacity: playing ? 0.8 : 0.3,
                        ['--eq-dur' as string]: `0.${7 + i}s`,
                      }}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close player"
                className="w-6 h-6 flex items-center justify-center rounded-md text-white/30 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0"
              >
                <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          {/* Controls */}
          <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
            {/* Seek bar */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/30 font-mono w-7 text-right tabular-nums">{fmt(progress)}</span>
              <div
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
                aria-valuenow={Math.floor(progress)}
                aria-valuetext={`${fmt(progress)} of ${fmt(duration)}`}
                tabIndex={0}
                className="flex-1 h-1.5 rounded-full cursor-pointer relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ background: 'rgba(255,255,255,0.1)' }}
                onClick={seek}
                onKeyDown={seekKeyDown}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-100 pointer-events-none"
                  style={{ width: `${pct}%`, background: '#00D9FF' }}
                />
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md pointer-events-none"
                  style={{ left: `calc(${pct}% - 6px)` }}
                />
              </div>
              <span className="text-[10px] text-white/30 font-mono w-7 tabular-nums">{fmt(duration)}</span>
            </div>

            {/* Playback buttons + volume */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => skip(-10)} aria-label="Skip back 10 seconds" className="text-white/30 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
                  <span className="material-symbols-outlined !text-[20px]" aria-hidden="true">replay_10</span>
                </button>
                <button
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause' : 'Play'}
                  className="w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  style={{ background: 'rgba(0,217,255,0.15)', border: '1px solid rgba(6,232,249,0.3)' }}
                >
                  <span className="material-symbols-outlined !text-[22px]" aria-hidden="true" style={{ color: '#00D9FF' }}>
                    {playing ? 'pause' : 'play_arrow'}
                  </span>
                </button>
                <button onClick={() => skip(10)} aria-label="Skip forward 10 seconds" className="text-white/30 hover:text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
                  <span className="material-symbols-outlined !text-[20px]" aria-hidden="true">forward_10</span>
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined !text-[16px] text-white/20" aria-hidden="true">
                  {volume === 0 ? 'volume_off' : volume < 50 ? 'volume_down' : 'volume_up'}
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  aria-label="Volume"
                  onChange={e => setVolume(Number(e.target.value))}
                  className="w-16 h-1 cursor-pointer accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                />
              </div>
            </div>

            {/* Load new URL */}
            <div className="flex gap-1.5 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <input
                aria-label="Paste YouTube URL to change track"
                className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                placeholder="Paste YouTube URL to change…"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    const m = val.match(YT_URL_RE);
                    if (m) { onLoad(m[1]); (e.target as HTMLInputElement).value = ''; }
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [currentView, setCurrentView] = useState('MainHub');
  const [ytVideoId, setYtVideoId] = useState<string | null>(() => localStorage.getItem(STORAGE_KEYS.ytVideoId) ?? null);
  const [showMusicInput, setShowMusicInput] = useState(false);
  const musicInputRef = useRef<HTMLInputElement>(null);

  const handleYtLoad = (id: string) => {
    setYtVideoId(id);
    try { localStorage.setItem(STORAGE_KEYS.ytVideoId, id); } catch { /* quota exceeded */ }
    setShowMusicInput(false);
  };
  const handleYtClose = () => {
    setYtVideoId(null);
    localStorage.removeItem(STORAGE_KEYS.ytVideoId);
  };

  useEffect(() => {
    if (showMusicInput) setTimeout(() => musicInputRef.current?.focus(), 50);
  }, [showMusicInput]);

  return (
    <ToastProvider>
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
              onOpenMusic={() => setShowMusicInput(v => !v)}
              musicActive={!!ytVideoId}
            />

            <YouTubeAudioPlayer videoId={ytVideoId} onClose={handleYtClose} onLoad={handleYtLoad} />

            {/* Music URL input popover (above sidebar music button) */}
            {showMusicInput && !ytVideoId && (
              <div
                className="fixed bottom-20 left-4 z-[300] rounded-xl overflow-hidden shadow-2xl border"
                style={{ background: '#0C0F1E', borderColor: 'rgba(255,255,255,0.1)', width: 248 }}
              >
                <div className="px-3 py-2 border-b flex items-center gap-2" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                  <span className="material-symbols-outlined !text-[16px] text-primary" aria-hidden="true">music_note</span>
                  <span className="text-[12px] text-white/60 font-medium">YouTube Music</span>
                  <button onClick={() => setShowMusicInput(false)} aria-label="Close music panel" className="ml-auto text-white/30 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded">
                    <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
                  </button>
                </div>
                <div className="p-2.5 flex gap-2">
                  <input
                    ref={musicInputRef}
                    aria-label="YouTube music URL"
                    className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                    placeholder="Paste YouTube URL…"
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setShowMusicInput(false); return; }
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value;
                        const m = val.match(YT_URL_RE);
                        if (m) handleYtLoad(m[1]);
                      }
                    }}
                  />
                  <button
                    aria-label="Play"
                    className="px-2.5 py-1.5 rounded-lg text-[11px] flex-shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    style={{ background: 'rgba(0,217,255,0.12)', border: '1px solid rgba(6,232,249,0.2)', color: '#00D9FF' }}
                    onClick={() => {
                      const val = musicInputRef.current?.value ?? '';
                      const m = val.match(YT_URL_RE);
                      if (m) handleYtLoad(m[1]);
                    }}
                  >
                    <span className="material-symbols-outlined !text-sm" aria-hidden="true">play_arrow</span>
                  </button>
                </div>
              </div>
            )}

            {currentView === 'MainHub' && <ErrorBoundary label="Main Hub"><MainHub setCurrentView={setCurrentView} /></ErrorBoundary>}
            {currentView === 'FocusMode' && <ErrorBoundary label="Focus Mode"><FocusMode setCurrentView={setCurrentView} /></ErrorBoundary>}
            {currentView === 'Communications' && <ErrorBoundary label="Communications"><Communications setCurrentView={setCurrentView} /></ErrorBoundary>}
            {currentView === 'Integrations' && <ErrorBoundary label="Integrations"><Integrations setCurrentView={setCurrentView} /></ErrorBoundary>}
            {currentView === 'Settings' && <ErrorBoundary label="Settings"><Settings setCurrentView={setCurrentView} /></ErrorBoundary>}
          </div>
        </EmailProvider>
      </TaskProvider>
    </ToastProvider>
  );
}
