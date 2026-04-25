import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/storageKeys';

export type ThemeMode = 'light' | 'dark';

export type AccentColor =
  | 'sky'      // Default: #38bdf8
  | 'purple'   // #a78bfa
  | 'rose'     // #fb7185
  | 'emerald'  // #34d399
  | 'amber'    // #fbbf24
  | 'indigo';  // #818cf8

const ACCENT_COLORS: Record<AccentColor, string> = {
  sky: '#38bdf8',
  purple: '#a78bfa',
  rose: '#fb7185',
  emerald: '#34d399',
  amber: '#fbbf24',
  indigo: '#818cf8',
};

interface ThemeState {
  mode: ThemeMode;
  accentColor: AccentColor;
}

interface ThemeActions {
  toggleMode: () => void;
  setMode: (mode: ThemeMode) => void;
  setAccentColor: (color: AccentColor) => void;
}

interface ThemeContextValue {
  state: ThemeState;
  actions: ThemeActions;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.themeMode);
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.themeAccent);
    return (saved && saved in ACCENT_COLORS) ? (saved as AccentColor) : 'sky';
  });

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.style.setProperty('--color-primary', ACCENT_COLORS[accentColor]);
    root.style.setProperty('color-scheme', mode);
  }, [mode, accentColor]);

  const toggleMode = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEYS.themeMode, next);
      return next;
    });
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEYS.themeMode, newMode);
  }, []);

  const setAccentColor = useCallback((color: AccentColor) => {
    setAccentColorState(color);
    localStorage.setItem(STORAGE_KEYS.themeAccent, color);
  }, []);

  return (
    <ThemeContext.Provider value={{
      state: { mode, accentColor },
      actions: { toggleMode, setMode, setAccentColor },
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
