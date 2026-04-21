import { useEffect, useMemo, useState } from 'react';

type ApiStatus = 'idle' | 'loading_api' | 'ready' | 'error';

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, config: any) => any; PlayerState?: any };
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
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? 'Failed to load YouTube API');
        setStatus('error');
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useMemo(() => ({ status, error }), [status, error]);
}

