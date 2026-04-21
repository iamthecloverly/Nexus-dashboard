import { useEffect, useMemo, useState } from 'react';

type MetaStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useYouTubeVideoMeta(videoId: string | null) {
  const [title, setTitle] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [status, setStatus] = useState<MetaStatus>('idle');

  useEffect(() => {
    let cancelled = false;

    setTitle(null);
    setAuthor(null);

    if (!videoId) {
      setStatus('idle');
      return () => { cancelled = true; };
    }

    setStatus('loading');

    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 8000);

    fetch(`https://www.youtube.com/oembed?format=json&url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      signal: ctl.signal,
    })
      .then(async res => {
        if (!res.ok) throw new Error(`oEmbed ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        const t = typeof data?.title === 'string' ? data.title.trim() : '';
        const a = typeof data?.author_name === 'string' ? data.author_name.trim() : '';
        setTitle(t || null);
        setAuthor(a || null);
        setStatus('ready');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      cancelled = true;
      ctl.abort();
      window.clearTimeout(timer);
    };
  }, [videoId]);

  return useMemo(() => ({
    title,
    author,
    status,
  }), [author, status, title]);
}
