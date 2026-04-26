import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../components/Toast';
import { extractYouTubeVideoId } from '../components/youtube/youtube';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { MusicContext } from './musicContext';

export function MusicProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();

  const [ytVideoId, setYtVideoId] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEYS.ytVideoId) ?? null; } catch { return null; }
  });

  const [showMusicInput, setShowMusicInput] = useState(false);
  const [musicPlayerVisible, setMusicPlayerVisible] = useState(true);

  const [ytVolume, setYtVolume] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ytVolume);
      const n = raw ? Number(raw) : 80;
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 80;
    } catch {
      return 80;
    }
  });

  const [resumeEnabled, setResumeEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ytResumeEnabled);
      return raw ? raw === '1' : true;
    } catch {
      return true;
    }
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

  const handleYtClose = useCallback(() => {
    setYtVideoId(null);
    try { localStorage.removeItem(STORAGE_KEYS.ytVideoId); } catch { /* ignore */ }
  }, []);

  const clearMusicSession = useCallback(() => {
    setYtVideoId(null);
    try { localStorage.removeItem(STORAGE_KEYS.ytVideoId); } catch { /* ignore */ }
  }, []);

  const toggleMusicChrome = useCallback(() => {
    if (ytVideoId) setMusicPlayerVisible(v => !v);
    else setShowMusicInput(v => !v);
  }, [ytVideoId]);

  const value = useMemo(() => ({
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
    setResumeEnabled,
    clearMusicSession,
    setVideoTitles,
    setShowMusicInput,
  }), [
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
    clearMusicSession,
    // setState functions from useState are stable references — included here for explicitness
    setMusicPlayerVisible,
    setYtVolume,
    setResumeEnabled,
    setVideoTitles,
    setShowMusicInput,
  ]);

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}
