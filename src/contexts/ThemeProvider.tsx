import React, { createContext, useContext, useEffect, useMemo } from 'react';

export type ThemeMode = 'dark';

export type AccentColor = 'sky';

const ACCENT_COLORS: Record<AccentColor, string> = {
  sky: '#38bdf8',
};

interface ThemeState {
  mode: ThemeMode;
  accentColor: AccentColor;
}

interface ThemeActions {
  toggleMode: () => void;
  setMode: (_mode: ThemeMode) => void;
  setAccentColor: (_color: AccentColor) => void;
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
  const mode: ThemeMode = 'dark';
  const accentColor: AccentColor = 'sky';

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.style.setProperty('--color-primary', ACCENT_COLORS[accentColor]);
    root.style.setProperty('color-scheme', mode);
  }, [mode, accentColor]);

  const actions = useMemo<ThemeActions>(() => {
    const noop = () => {};
    return {
      toggleMode: noop,
      setMode: noop as ThemeActions['setMode'],
      setAccentColor: noop as ThemeActions['setAccentColor'],
    };
  }, []);

  return (
    <ThemeContext.Provider value={{
      state: { mode, accentColor },
      actions,
    }}>
      {children}
    </ThemeContext.Provider>
  );
}
