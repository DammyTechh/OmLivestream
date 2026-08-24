import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme, useWindowDimensions, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { dark, light, type Theme } from '@/constants/theme';

/**
 * Theme + layout context.
 *
 * Two separate jobs that always get consumed together, so they share a
 * provider:
 *
 *  1. Colours, following the OS appearance setting. Following the system
 *     rather than shipping an in-app toggle is the right default on mobile —
 *     people set this once, at the OS level, and expect apps to respect it.
 *
 *  2. Layout class. Phones range from a 320pt SE to a 430pt Pro Max to a
 *     1024pt iPad, and "responsive" on native means adapting to that range,
 *     not just not crashing. Screens read `layout` instead of hard-coding
 *     widths, so a compact phone gets tighter gutters and a tablet gets a
 *     capped content column rather than text stretched to 1000pt.
 */

export type ThemePref = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  t: Theme;
  isDark: boolean;
  /** What the user chose. 'system' follows the OS. */
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  /** Breakpoint class, derived from the shorter edge so rotation is stable. */
  layout: 'compact' | 'regular' | 'expanded';
  /** Horizontal page padding appropriate to the layout class. */
  gutter: number;
  /** Cap on readable content width; centres the column on large screens. */
  maxContentWidth: number;
  /** Columns for card grids at this size. */
  columns: number;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const PREF_KEY = 'omlive_theme_pref';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const { width, height } = useWindowDimensions();

  /**
   * Light by default, matching the website.
   *
   * The previous default was `scheme !== 'light'`, which meant *dark* unless
   * the OS explicitly said light — so a phone with no preference set opened a
   * dark app while omlivestream.com opened light. Two faces of one product
   * should not disagree about something this visible.
   *
   * 'light' is therefore the starting point, and the choice is the user's from
   * there. Persisted, because a preference that resets every launch is not a
   * preference.
   */
  const [pref, setPrefState] = useState<ThemePref>('light');

  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY)
      .then((v) => { if (v === 'light' || v === 'dark' || v === 'system') setPrefState(v); })
      .catch(() => { /* first run, or storage unavailable */ });
  }, []);

  const setPref = React.useCallback((p: ThemePref) => {
    setPrefState(p);
    AsyncStorage.setItem(PREF_KEY, p).catch(() => { /* non-fatal */ });
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const isDark = pref === 'system' ? scheme === 'dark' : pref === 'dark';
    // The shorter edge classifies the device: a phone in landscape is still a
    // phone, and shouldn't suddenly adopt tablet layout.
    const shortest = Math.min(width, height);

    const layout: ThemeContextValue['layout'] =
      shortest < 360 ? 'compact' : shortest < 600 ? 'regular' : 'expanded';

    return {
      t: isDark ? dark : light,
      isDark,
      pref,
      setPref,
      layout,
      gutter: layout === 'compact' ? 14 : layout === 'regular' ? 18 : 28,
      maxContentWidth: layout === 'expanded' ? 720 : width,
      columns: layout === 'expanded' ? 3 : 2,
    };
  }, [scheme, width, height, pref, setPref]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** True on iOS, where blur materials and large titles are native idiom. */
export const isIOS = Platform.OS === 'ios';
