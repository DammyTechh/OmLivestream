'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Theme state.
 * ─────────────────────────────────────────────────────────────────────────────
 * Light is the product default. A visitor who has never chosen gets light, and
 * that stays true on a fresh device and in a private window.
 *
 * Only an explicit choice is stored. We deliberately do not fall back to
 * `prefers-color-scheme`, because a great many people run their OS in dark mode
 * without wanting every site dark — honouring it would quietly override the
 * intended default for them.
 */
export type Theme = 'light' | 'dark';

/** Also referenced by the pre-hydration script in app/layout.tsx. */
export const THEME_STORAGE_KEY = 'omls-theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  /** False until the stored choice has been read, so nothing renders a guess. */
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Reads what the pre-hydration script already decided, so the two never disagree. */
function readAppliedTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Seeded from the DOM rather than from a constant. The inline script in the
  // document head has already applied the class by the time this runs, so
  // reading it back means the first client render matches what is on screen.
  const [theme, setThemeState] = useState<Theme>(readAppliedTheme);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setThemeState(readAppliedTheme());

    // The colour transition is enabled one frame after mount. Doing it
    // immediately would animate the initial paint, so a dark-mode user would
    // watch the whole page fade from light to dark on every navigation.
    const frame = requestAnimationFrame(() => {
      document.documentElement.classList.add('theme-ready');
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    const root = document.documentElement;
    root.classList.toggle('dark', next === 'dark');
    // Keeps form controls, scrollbars and the like in step with the theme.
    root.style.colorScheme = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Safari in private mode throws on write. The theme still applies for
      // this session; it just will not be remembered, which is acceptable.
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(readAppliedTheme() === 'dark' ? 'light' : 'dark');
  }, [setTheme]);

  // Reflect the choice across tabs, so switching in one updates the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_STORAGE_KEY || !e.newValue) return;
      if (e.newValue === 'light' || e.newValue === 'dark') {
        setThemeState(e.newValue);
        document.documentElement.classList.toggle('dark', e.newValue === 'dark');
        document.documentElement.style.colorScheme = e.newValue;
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, ready }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
