import { createContext, useContext } from 'react';

export interface MusicContextValue {
  ytVideoId: string | null;
  showMusicInput: boolean;
  musicPlayerVisible: boolean;
  ytVolume: number;
  resumeEnabled: boolean;
  videoTitles: Record<string, string>;
  ytPositions: Record<string, number>;
  savePosition: (videoId: string, seconds: number) => void;
  handleYtLoad: (id: string) => void;
  handleYtClose: () => void;
  handleYtRequestLoad: (input: string) => void;
  toggleMusicChrome: () => void;
  setMusicPlayerVisible: (v: boolean | ((prev: boolean) => boolean)) => void;
  setYtVolume: (v: number) => void;
  setResumeEnabled: (v: boolean) => void;
  clearMusicSession: () => void;
  setVideoTitles: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
  setShowMusicInput: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusicContext(): MusicContextValue {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error('useMusicContext must be used within MusicProvider');
  return ctx;
}
