import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../Toast';
import { useYouTubeIFrameApi } from './useYouTubeIFrameApi';
import { formatTimeSeconds } from './youtube';

type PlayerStatus = 'idle' | 'loading_video' | 'ready' | 'autoplay_blocked' | 'error';

export function YouTubeAudioPlayer({
  videoId,
  visible,
  volume,
  resumeEnabled,
  savedPositions,
  onSavePosition,
  onClose,
  onToggleVisible,
  onVolumeChange,
  onRequestLoad,
}: {
  videoId: string | null;
  visible: boolean;
  volume: number;
  resumeEnabled: boolean;
  savedPositions: Record<string, number>;
  onSavePosition: (videoId: string, seconds: number) => void;
  onClose: () => void;
  onToggleVisible: () => void;
  onVolumeChange: (v: number) => void;
  onRequestLoad: (input: string) => void;
}) {
  const { showToast } = useToast();
  const { status: apiStatus, error: apiError } = useYouTubeIFrameApi();

  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);

  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('idle');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const progressRafRef = useRef<number | null>(null);
  const lastProgressRef = useRef<number>(0);

  const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
  const pct = duration > 0 ? Math.max(0, Math.min(100, (progress / duration) * 100)) : 0;

  // Create / switch video when videoId changes (once API is ready)
  useEffect(() => {
    if (!videoId) {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      setPlayerStatus('idle');
      return;
    }
    if (apiStatus === 'error') {
      setPlayerStatus('error');
      return;
    }
    if (apiStatus !== 'ready') return;

    let active = true;
    setPlayerStatus('loading_video');

    const init = () => {
      if (!active) return;
      if (!playerDivRef.current || !window.YT?.Player) return;

      const ensureDuration = (p: any) => {
        try {
          const d = p.getDuration?.() ?? 0;
          if (d > 0) setDuration(d);
        } catch { /* ignore */ }
      };

      if (playerRef.current) {
        try {
          playerRef.current.loadVideoById(videoId);
          setPlayerStatus('ready');
        } catch (e: any) {
          setPlayerStatus('error');
          showToast(e?.message ?? 'Failed to load video', 'error');
        }
        return;
      }

      try {
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
            origin: window.location.origin,
          },
          events: {
            onReady: (e: any) => {
              if (!active) return;
              try { e.target.setVolume(volume); } catch { /* ignore */ }
              try { e.target.playVideo(); } catch { /* ignore */ }
              // If autoplay is blocked, the state won't become PLAYING soon.
              setTimeout(() => {
                if (!active) return;
                const stillNotPlaying = !playing;
                if (stillNotPlaying) setPlayerStatus('autoplay_blocked');
              }, 800);
            },
            onStateChange: (e: any) => {
              if (!active) return;
              const isNowPlaying = e.data === 1; // PLAYING
              setPlaying(isNowPlaying);
              if (e.data === 1 || e.data === 3) ensureDuration(e.target); // PLAYING or BUFFERING
              if (e.data === 1) setPlayerStatus('ready');
            },
            onError: () => {
              if (!active) return;
              setPlayerStatus('error');
              setPlaying(false);
              showToast('YouTube playback error — try another link', 'error');
            },
          },
        });
      } catch (e: any) {
        setPlayerStatus('error');
        showToast(e?.message ?? 'Failed to initialize YouTube player', 'error');
      }
    };

    init();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, apiStatus]);

  // Resume last position (once we have a duration)
  useEffect(() => {
    if (!resumeEnabled) return;
    if (!videoId) return;
    if (!playerRef.current?.seekTo) return;
    if (!duration) return;
    const saved = savedPositions[videoId];
    if (!saved || !Number.isFinite(saved)) return;
    // Don't resume from near the end; clamp within range
    const target = Math.max(0, Math.min(duration - 2, saved));
    if (target < 5) return;
    try { playerRef.current.seekTo(target, true); setProgress(target); } catch { /* ignore */ }
    // Only do this once per load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeEnabled, videoId, duration]);

  // Persist position periodically while playing
  useEffect(() => {
    if (!resumeEnabled) return;
    if (!videoId) return;
    if (!playing) return;
    const id = window.setInterval(() => {
      try {
        const t = playerRef.current?.getCurrentTime?.();
        if (typeof t === 'number' && Number.isFinite(t) && t > 1) onSavePosition(videoId, t);
      } catch { /* ignore */ }
    }, 3000);
    return () => window.clearInterval(id);
  }, [resumeEnabled, videoId, playing, onSavePosition]);

  // Sync volume to the player
  useEffect(() => {
    if (!playerRef.current?.setVolume) return;
    try { playerRef.current.setVolume(volume); } catch { /* ignore */ }
  }, [volume]);

  // Progress tracking (rAF while playing)
  useEffect(() => {
    if (!playing) {
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
      return;
    }

    const tick = () => {
      try {
        const t = playerRef.current?.getCurrentTime?.();
        if (typeof t === 'number' && Number.isFinite(t)) {
          // Reduce renders: only update when value changed noticeably
          if (Math.abs(t - lastProgressRef.current) >= 0.25) {
            lastProgressRef.current = t;
            setProgress(t);
          }
        }
      } catch { /* ignore */ }
      progressRafRef.current = requestAnimationFrame(tick);
    };

    progressRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (progressRafRef.current) cancelAnimationFrame(progressRafRef.current);
      progressRafRef.current = null;
    };
  }, [playing]);

  const togglePlay = () => {
    if (!playerRef.current) return;
    try {
      playing ? playerRef.current.pauseVideo?.() : playerRef.current.playVideo?.();
    } catch { /* ignore */ }
  };

  const skip = (delta: number) => {
    if (!playerRef.current) return;
    const next = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, progress + delta));
    try { playerRef.current.seekTo?.(next, true); } catch { /* ignore */ }
    setProgress(next);
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!playerRef.current || !duration) return;
    const native = e.nativeEvent as MouseEvent;
    const x = (native as any).offsetX as number | undefined;
    const w = e.currentTarget.clientWidth;
    if (typeof x !== 'number' || !w) return;
    const t = Math.max(0, Math.min(duration, (x / w) * duration));
    try { playerRef.current.seekTo?.(t, true); } catch { /* ignore */ }
    setProgress(t);
  };

  const seekKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); skip(5); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); skip(-5); }
    if (e.key === 'Home') { e.preventDefault(); skip(-progress); }
    if (e.key === 'End')  { e.preventDefault(); skip(duration - progress); }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlay(); }
  };

  const volumeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onVolumeChange(Math.min(100, volume + 5));
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onVolumeChange(Math.max(0, volume - 5));
    }
    if (e.key === 'Home') { e.preventDefault(); onVolumeChange(0); }
    if (e.key === 'End') { e.preventDefault(); onVolumeChange(100); }
  };

  const statusLabel = useMemo(() => {
    if (apiStatus === 'loading_api' || apiStatus === 'idle') return 'Loading YouTube…';
    if (apiStatus === 'error') return apiError ?? 'Failed to load YouTube';
    if (!videoId) return 'No track loaded';
    if (playerStatus === 'loading_video') return 'Loading track…';
    if (playerStatus === 'autoplay_blocked') return 'Autoplay blocked';
    if (playerStatus === 'error') return 'Playback error';
    return null;
  }, [apiStatus, apiError, videoId, playerStatus]);

  // Always-mounted off-screen player so audio persists even if UI is hidden
  return (
    <>
      <div
        ref={playerDivRef}
        aria-hidden="true"
        style={{ position: 'fixed', left: -9999, top: 0, width: 320, height: 180, pointerEvents: 'none' }}
      />

      {videoId && visible && (
        <div className="fixed bottom-6 right-6 z-[200] w-72 rounded-2xl overflow-hidden shadow-2xl border border-white/[0.08]" style={{ background: '#0C0F1E' }}>
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
                className="w-6 h-6 flex items-center justify-center rounded-md text-white/30 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined !text-sm" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
            {statusLabel && (
              <div className="text-[11px] text-white/40 font-medium">
                {statusLabel}
                {playerStatus === 'autoplay_blocked' && (
                  <button
                    onClick={() => { try { playerRef.current?.playVideo?.(); setPlayerStatus('ready'); } catch { /* ignore */ } }}
                    className="ml-2 text-[11px] text-primary hover:underline font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                  >
                    Tap to play
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/30 font-mono w-7 text-right tabular-nums">{formatTimeSeconds(progress)}</span>
              <div
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
                aria-valuenow={Math.floor(progress)}
                aria-valuetext={`${formatTimeSeconds(progress)} of ${formatTimeSeconds(duration)}`}
                tabIndex={0}
                className="flex-1 h-1.5 rounded-full cursor-pointer relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ background: 'rgba(255,255,255,0.1)' }}
                onClick={seek}
                onKeyDown={seekKeyDown}
              >
                <div className="h-full rounded-full transition-[width] duration-100 pointer-events-none" style={{ width: `${pct}%`, background: '#00D9FF' }} />
                <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white shadow-md pointer-events-none" style={{ left: `calc(${pct}% - 6px)` }} />
              </div>
              <span className="text-[10px] text-white/30 font-mono w-7 tabular-nums">{formatTimeSeconds(duration)}</span>
            </div>

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
                  onChange={e => onVolumeChange(Number(e.target.value))}
                  onKeyDown={volumeKeyDown}
                  className="w-16 h-1 cursor-pointer accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                />
              </div>
            </div>

            <div className="flex gap-1.5 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <input
                aria-label="Paste YouTube URL or video ID to change track"
                className="flex-1 min-w-0 rounded-lg px-2.5 py-1.5 text-[11px] text-white placeholder-white/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
                placeholder="Paste YouTube URL or ID…"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    onRequestLoad(val);
                    (e.target as HTMLInputElement).value = '';
                  }
                }}
              />
              <button
                onClick={onToggleVisible}
                aria-label="Hide player"
                className="px-2.5 py-1.5 rounded-lg text-[11px] flex-shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)' }}
              >
                Hide
              </button>
            </div>
          </div>
        </div>
      )}

      {videoId && !visible && (
        <button
          onClick={onToggleVisible}
          className="fixed bottom-6 right-6 z-[200] px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-xs text-white/80 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          aria-label="Show player"
        >
          Show player
        </button>
      )}
    </>
  );
}

