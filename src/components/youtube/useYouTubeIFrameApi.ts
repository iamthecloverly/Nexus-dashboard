import { useEffect, useMemo, useState } from 'react';

type ApiStatus = 'idle' | 'loading_api' | 'ready' | 'error';

export interface YTPlayer {
  loadVideoById(videoId: string): void;
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  getVolume(): number;
  getDuration(): number;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTPlayerEvent { target: YTPlayer; }
export interface YTStateChangeEvent { target: YTPlayer; data: number; }
export interface YTErrorEvent { target: YTPlayer; data: number; }

interface YTPlayerVars {
  autoplay?: number;
  controls?: number;
  rel?: number;
  modestbranding?: number;
  enablejsapi?: number;
  origin?: string;
}

interface YTPlayerConfig {
  height?: string | number;
  width?: string | number;
  videoId?: string;
  playerVars?: YTPlayerVars;
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: YTStateChangeEvent) => void;
    onError?: (event: YTErrorEvent) => void;
  };
}

interface YTNamespace {
  Player: new (el: HTMLElement, config: YTPlayerConfig) => YTPlayer;
  PlayerState?: {
    UNSTARTED: number;
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let _loaderPromise: Promise<void> | null = null;

function loadYouTubeIFrameApi(): Promise<void> {
  if (window.YT?.Player) return Promise.resolve();
  if (_loaderPromise) return _loaderPromise;

  _loaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById('yt-api-script');
    if (existing) {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
      // If the script already loaded between checks
      if (window.YT?.Player) resolve();
      return;
    }

    const tag = document.createElement('script');
    tag.id = 'yt-api-script';
    tag.src = 'https://www.youtube.com/iframe_api';
    tag.async = true;
    tag.onerror = () => reject(new Error('Failed to load YouTube IFrame API'));

    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };

    document.head.appendChild(tag);
  });

  return _loaderPromise;
}

/** Best-effort preload to reduce first-open latency (safe to call repeatedly). */
export function preloadYouTubeIFrameApi(): void {
  try {
    void loadYouTubeIFrameApi().catch(() => { /* ignore */ });
  } catch {
    // ignore
  }
}

export function useYouTubeIFrameApi() {
  const [status, setStatus] = useState<ApiStatus>(() => (typeof window !== 'undefined' && window.YT?.Player ? 'ready' : 'idle'));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (status === 'ready') return;
    setStatus('loading_api');
    loadYouTubeIFrameApi()
      .then(() => {
        if (cancelled) return;
        setStatus('ready');
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load YouTube API');
        setStatus('error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(() => ({ status, error }), [status, error]);
}

