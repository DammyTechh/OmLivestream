import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme, useWindowDimensions, Platform } from 'react-native';
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

interface ThemeContextValue {
  t: Theme;
  isDark: boolean;
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

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const { width, height } = useWindowDimensions();

  const value = useMemo<ThemeContextValue>(() => {
    const isDark = scheme !== 'light';
    // The shorter edge classifies the device: a phone in landscape is still a
    // phone, and shouldn't suddenly adopt tablet layout.
    const shortest = Math.min(width, height);

    const layout: ThemeContextValue['layout'] =
      shortest < 360 ? 'compact' : shortest < 600 ? 'regular' : 'expanded';

    return {
      t: isDark ? dark : light,
      isDark,
      layout,
      gutter: layout === 'compact' ? 14 : layout === 'regular' ? 18 : 28,
      maxContentWidth: layout === 'expanded' ? 720 : width,
      columns: layout === 'expanded' ? 3 : 2,
    };
  }, [scheme, width, height]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/** True on iOS, where blur materials and large titles are native idiom. */
export const isIOS = Platform.OS === 'ios';
