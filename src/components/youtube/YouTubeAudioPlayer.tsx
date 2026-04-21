import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../Toast';
import { useYouTubeIFrameApi } from './useYouTubeIFrameApi';
import { formatTimeSeconds } from './youtube';
import { useYouTubeVideoMeta } from './useYouTubeVideoMeta';

type PlayerStatus = 'idle' | 'loading_video' | 'ready' | 'autoplay_blocked' | 'playback_unavailable' | 'error';

export function YouTubeAudioPlayer({
  videoId,
  visible,
  volume,
  resumeEnabled,
  savedPositions,
  onSavePosition,
  bottomOffsetPx = 24,
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
  bottomOffsetPx?: number;
  onClose: () => void;
  onToggleVisible: () => void;
  onVolumeChange: (v: number) => void;
  onRequestLoad: (input: string) => void;
}) {
  const { showToast } = useToast();
  const { status: apiStatus, error: apiError } = useYouTubeIFrameApi();
  const meta = useYouTubeVideoMeta(videoId);

  const playerRef = useRef<any>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const autoplayProbeRef = useRef<number | null>(null);

  const [playerStatus, setPlayerStatus] = useState<PlayerStatus>('idle');
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const progressRafRef = useRef<number | null>(null);
  const lastProgressRef = useRef<number>(0);

  const thumb = videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null;
  const pct = duration > 0 ? Math.max(0, Math.min(100, (progress / duration) * 100)) : 0;

  const ytErrorReason = useCallback((code?: number): string => {
    // https://developers.google.com/youtube/iframe_api_reference
    switch (code) {
      case 2: return 'Invalid parameters';
      case 5: return 'HTML5 playback error';
      case 100: return 'Video not found';
      case 101:
      case 150: return 'Embed disabled for this video';
      default: return 'Playback error';
    }
  }, []);

  // Create / switch video when videoId changes (once API is ready)
  useEffect(() => {
    if (!videoId) {
      playerRef.current?.destroy?.();
      playerRef.current = null;
      setPlaying(false);
      setProgress(0);
      setDuration(0);
      setPlayerStatus('idle');
      if (autoplayProbeRef.current) window.clearTimeout(autoplayProbeRef.current);
      autoplayProbeRef.current = null;
      return;
    }
    if (apiStatus === 'error') {
      setPlayerStatus('error');
      return;
    }
    if (apiStatus !== 'ready') return;

    let active = true;
    setPlayerStatus('loading_video');
    if (autoplayProbeRef.current) window.clearTimeout(autoplayProbeRef.current);
    autoplayProbeRef.current = null;

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
          setPlaying(false);
          setPlayerStatus('loading_video');
          if (autoplayProbeRef.current) window.clearTimeout(autoplayProbeRef.current);
          autoplayProbeRef.current = null;
          playerRef.current.loadVideoById(videoId);
          setPlayerStatus('ready');
          try { playerRef.current.playVideo?.(); } catch { /* ignore */ }
          autoplayProbeRef.current = window.setTimeout(() => {
            if (!active) return;
            try {
              const ps = playerRef.current?.getPlayerState?.();
              if (ps !== 1 && ps !== 3) setPlayerStatus('autoplay_blocked');
            } catch {
              setPlayerStatus('autoplay_blocked');
            }
          }, 900);
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
              // If autoplay is blocked, we won't reach PLAYING quickly.
              autoplayProbeRef.current = window.setTimeout(() => {
                if (!active) return;
                try {
                  const ps = e.target?.getPlayerState?.();
                  // 1 = PLAYING, 3 = BUFFERING
                  if (ps !== 1 && ps !== 3) setPlayerStatus('autoplay_blocked');
                } catch {
                  setPlayerStatus('autoplay_blocked');
                }
              }, 900);
            },
            onStateChange: (e: any) => {
              if (!active) return;
              const isNowPlaying = e.data === 1; // PLAYING
              setPlaying(isNowPlaying);
              if (e.data === 1 || e.data === 3) ensureDuration(e.target); // PLAYING or BUFFERING
              if (e.data === 1 || e.data === 3) {
                // Playing or buffering — unblock autoplay warnings
                if (autoplayProbeRef.current) window.clearTimeout(autoplayProbeRef.current);
                autoplayProbeRef.current = null;
                if (e.data === 1) setPlayerStatus('ready');
              }
            },
            onError: (e: any) => {
              if (!active) return;
              const code = typeof e?.data === 'number' ? e.data : undefined;
              setPlaying(false);
              if (code === 101 || code === 150) {
                setPlayerStatus('playback_unavailable');
                showToast('This video cannot be embedded — try another link', 'error');
                return;
              }
              setPlayerStatus('error');
              showToast(ytErrorReason(code), 'error');
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
      if (autoplayProbeRef.current) window.clearTimeout(autoplayProbeRef.current);
      autoplayProbeRef.current = null;
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
      if (playerStatus === 'playback_unavailable') return;
      playing ? playerRef.current.pauseVideo?.() : playerRef.current.playVideo?.();
    } catch { /* ignore */ }
  };

  const skip = (delta: number) => {
    if (!playerRef.current) return;
    if (playerStatus === 'playback_unavailable') return;
    const next = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, progress + delta));
    try { playerRef.current.seekTo?.(next, true); } catch { /* ignore */ }
    setProgress(next);
  };

  const seekFromClientX = useCallback((clientX: number, bar: HTMLDivElement) => {
    if (!playerRef.current || !duration) return;
    const rect = bar.getBoundingClientRect();
    const w = rect.width;
    if (!w) return;
    const x = Math.max(0, Math.min(w, clientX - rect.left));
    const t = Math.max(0, Math.min(duration, (x / w) * duration));
    try { playerRef.current.seekTo?.(t, true); } catch { /* ignore */ }
    setProgress(t);
  }, [duration]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    seekFromClientX(e.clientX, e.currentTarget);
  };

  const seekBarRef = useRef<HTMLDivElement>(null);
  const draggingSeekRef = useRef(false);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!draggingSeekRef.current) return;
      const bar = seekBarRef.current;
      if (!bar) return;
      seekFromClientX(ev.clientX, bar);
    };
    const onUp = () => { draggingSeekRef.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [seekFromClientX]);

  useEffect(() => {
    const onTouchMove = (ev: TouchEvent) => {
      if (!draggingSeekRef.current) return;
      const bar = seekBarRef.current;
      if (!bar) return;
      const t = ev.touches[0];
      if (!t) return;
      seekFromClientX(t.clientX, bar);
    };
    const onTouchEnd = () => { draggingSeekRef.current = false; };
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [seekFromClientX]);

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
    if (playerStatus === 'playback_unavailable') return 'Cannot embed this video';
    if (playerStatus === 'error') return 'Playback error';
    return null;
  }, [apiStatus, apiError, videoId, playerStatus]);

  const displayTitle = useMemo(() => {
    const t = meta.title?.trim();
    if (t) return t;
    if (meta.status === 'loading') return 'Loading title…';
    return 'YouTube track';
  }, [meta.status, meta.title]);

  const displaySubtitle = useMemo(() => {
    const a = meta.author?.trim();
    if (a) return a;
    return videoId ? `Video ID · ${videoId}` : '';
  }, [meta.author, videoId]);

  // Always-mounted off-screen player so audio persists even if UI is hidden
  return (
    <>
      <div
        ref={playerDivRef}
        aria-hidden="true"
        style={{ position: 'fixed', left: -9999, top: 0, width: 320, height: 180, pointerEvents: 'none' }}
      />

      {videoId && visible && (
        <div
          className="fixed right-6 z-[200] w-[min(22rem,calc(100vw-3rem))] rounded-2xl overflow-hidden shadow-[0_25px_80px_rgba(0,0,0,0.55)] border border-white/[0.10] backdrop-blur-md"
          style={{
            bottom: bottomOffsetPx,
            background: 'linear-gradient(180deg, rgba(16,19,34,0.92) 0%, rgba(8,11,22,0.96) 100%)',
          }}
          role="region"
          aria-label="YouTube music player"
        >
          <div className="relative h-[4.25rem] overflow-hidden flex-shrink-0">
            {thumb && <img src={thumb} width={320} height={68} className="absolute inset-0 w-full h-full object-cover scale-110 blur-lg opacity-70" alt="" />}
            <div className="absolute inset-0 bg-gradient-to-r from-[#050816]/95 via-[#050816]/70 to-transparent" />
            <div className="relative flex items-center gap-3 px-3.5 h-full">
              {thumb && (
                <img
                  src={thumb}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded-xl object-cover flex-shrink-0 shadow-[0_10px_30px_rgba(0,0,0,0.45)] ring-1 ring-white/10"
                  alt=""
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-[0.22em] font-semibold text-white/35">Now playing</p>
                <p className="text-[13px] font-semibold text-white truncate leading-snug">{displayTitle}</p>
                <p className="text-[11px] text-white/45 truncate">{displaySubtitle}</p>
              </div>
              <button
                onClick={onClose}
                aria-label="Stop and close player"
                className="w-8 h-8 flex items-center justify-center rounded-xl text-white/35 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="material-symbols-outlined !text-[18px]" aria-hidden="true">close</span>
              </button>
            </div>
          </div>

          <div className="px-4 pt-3 pb-4 flex flex-col gap-3">
            {statusLabel && (
              <div
                className={`rounded-xl px-3 py-2 text-[11px] leading-relaxed border ${
                  playerStatus === 'playback_unavailable' || playerStatus === 'error'
                    ? 'border-red-500/25 bg-red-500/10 text-red-100/90'
                    : playerStatus === 'autoplay_blocked'
                      ? 'border-amber-400/25 bg-amber-400/10 text-amber-50/90'
                      : 'border-white/10 bg-white/[0.04] text-white/55'
                }`}
              >
                <span className="font-medium">{statusLabel}</span>
                {playerStatus === 'autoplay_blocked' && (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        playerRef.current?.playVideo?.();
                      } catch { /* ignore */ }
                    }}
                    className="ml-2 text-[11px] text-primary hover:underline font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded"
                  >
                    Resume
                  </button>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white/35 font-mono w-9 text-right tabular-nums">{formatTimeSeconds(progress)}</span>
              <div
                ref={seekBarRef}
                role="slider"
                aria-label="Seek"
                aria-valuemin={0}
                aria-valuemax={Math.floor(duration)}
                aria-valuenow={Math.floor(progress)}
                aria-valuetext={`${formatTimeSeconds(progress)} of ${formatTimeSeconds(duration)}`}
                tabIndex={0}
                className="group flex-1 h-2 rounded-full cursor-pointer relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary touch-none"
                style={{ background: 'rgba(255,255,255,0.08)' }}
                onMouseDown={e => {
                  draggingSeekRef.current = true;
                  seekFromClientX(e.clientX, e.currentTarget);
                }}
                onTouchStart={e => {
                  const t = e.touches[0];
                  if (!t) return;
                  draggingSeekRef.current = true;
                  seekFromClientX(t.clientX, e.currentTarget);
                }}
                onClick={seek}
                onKeyDown={seekKeyDown}
              >
                <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary/90 to-primary/40 transition-[width] duration-75 pointer-events-none" style={{ width: `${pct}%` }} />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-white shadow-[0_0_0_4px_rgba(0,217,255,0.15)] opacity-90 group-hover:opacity-100 pointer-events-none transition-opacity"
                  style={{ left: `calc(${pct}% - 7px)` }}
                />
              </div>
              <span className="text-[10px] text-white/35 font-mono w-9 tabular-nums">{formatTimeSeconds(duration)}</span>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1">
                <button onClick={() => skip(-10)} aria-label="Skip back 10 seconds" className="w-10 h-10 flex items-center justify-center rounded-xl text-white/35 hover:text-white hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <span className="material-symbols-outlined !text-[22px]" aria-hidden="true">replay_10</span>
                </button>
                <button
                  onClick={togglePlay}
                  aria-label={playing ? 'Pause' : 'Play'}
                  className="w-12 h-12 rounded-2xl flex items-center justify-center transition-transform hover:scale-[1.03] active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary shadow-[0_12px_40px_rgba(0,217,255,0.18)]"
                  style={{ background: 'linear-gradient(135deg, rgba(0,217,255,0.22) 0%, rgba(99,102,241,0.18) 100%)', border: '1px solid rgba(6,232,249,0.35)' }}
                >
                  <span className="material-symbols-outlined !text-[26px]" aria-hidden="true" style={{ color: '#00D9FF' }}>
                    {playing ? 'pause' : 'play_arrow'}
                  </span>
                </button>
                <button onClick={() => skip(10)} aria-label="Skip forward 10 seconds" className="w-10 h-10 flex items-center justify-center rounded-xl text-white/35 hover:text-white hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <span className="material-symbols-outlined !text-[22px]" aria-hidden="true">forward_10</span>
                </button>
              </div>

              <div className="flex items-center gap-2 min-w-[7.5rem]">
                <span className="material-symbols-outlined !text-[18px] text-white/25" aria-hidden="true">
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
                  className="w-full h-1.5 cursor-pointer accent-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary rounded-full"
                />
              </div>
            </div>

            <div className="flex gap-2 border-t pt-3" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <input
                aria-label="Paste YouTube URL or video ID to change track"
                className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[12px] text-white placeholder-white/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/35 transition-colors"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)' }}
                placeholder="Change track — paste URL or ID…"
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
                className="px-3 py-2 rounded-xl text-[12px] flex-shrink-0 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary font-medium"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.78)' }}
              >
                Hide
              </button>
            </div>
            <p className="text-[10px] text-white/25 leading-snug">
              Space toggles play/pause when the seek bar is focused. Arrow keys seek by 5 seconds.
            </p>
          </div>
        </div>
      )}

      {videoId && !visible && (
        <button
          onClick={onToggleVisible}
          className="fixed right-6 z-[200] flex items-center gap-2 pl-3 pr-3.5 py-2.5 rounded-2xl border border-white/10 bg-white/[0.06] hover:bg-white/[0.10] text-xs text-white/85 shadow-[0_18px_60px_rgba(0,0,0,0.45)] backdrop-blur-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          style={{ bottom: bottomOffsetPx }}
          aria-label="Show player"
        >
          <span className="material-symbols-outlined !text-[18px] text-primary" aria-hidden="true">music_note</span>
          <span className="font-medium">Music</span>
        </button>
      )}
    </>
  );
}

