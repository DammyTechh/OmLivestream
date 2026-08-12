/**
 * Design tokens in JavaScript form.
 * ─────────────────────────────────────────────────────────────────
 * Tailwind owns the palette for anything that takes a className. This file is
 * for the places that cannot use one: Recharts, canvas work, inline SVG.
 *
 * Those consumers need literal colour values. Recharts in particular passes
 * `stroke` and `fill` straight through as SVG presentation attributes, and
 * those do not resolve `var(--c-primary)` — so the CSS-variable trick that
 * works everywhere else in the product does not work here. Charts have to be
 * handed the actual hex for the theme that is currently on screen.
 *
 * Hence two palettes and a hook. Keep both in sync with the variable blocks in
 * styles/globals.css; these are the same values in a different form.
 */

'use client';

import { useTheme } from '@/components/theme/ThemeProvider';

export interface Palette {
  bg: string;
  surface: string;
  elevated: string;
  border: string;
  text: string;
  muted: string;
  subtle: string;
  primary: string;
  primaryDeep: string;
  accent: string;
  success: string;
  warning: string;
  severe: string;
  danger: string;
}

const dark: Palette = {
  bg:          '#0D0A1E',
  surface:     '#14102A',
  elevated:    '#1F1538',
  border:      '#231447',
  text:        '#F8F5FF',
  muted:       '#9B97B4',
  subtle:      '#84809A',
  primary:     '#A855F7',
  primaryDeep: '#7C3AED',
  accent:      '#EC4899',
  success:     '#10B981',
  warning:     '#F59E0B',
  severe:      '#FB923C',
  danger:      '#EF4444',
};

/**
 * The light palette is not the dark one lightened. The brand and status hues
 * are all deepened, because the dark-theme values are too light to read on a
 * white chart: #10B981 sits at 2.32:1 against the page and #F59E0B at 1.97:1,
 * so a line drawn in either is effectively invisible. The status hues go one
 * step deeper still — see the note in globals.css about tinted chips.
 */
const light: Palette = {
  bg:          '#F6F4FA',
  surface:     '#FFFFFF',
  elevated:    '#EFEBF7',
  border:      '#DCD9E2',
  text:        '#1A1330',
  muted:       '#5B5573',
  subtle:      '#6D6885',
  primary:     '#6D28D9',
  primaryDeep: '#5B21B6',
  accent:      '#DB2777',
  success:     '#065F46',
  warning:     '#92400E',
  severe:      '#9A3412',
  danger:      '#991B1B',
};

export const palettes = { light, dark } as const;

/**
 * Static export kept for non-React callers and for the brand colours that are
 * theme-independent. Prefer `useChartTheme()` in components — this one cannot
 * know which theme is active.
 */
export const palette = dark;

/**
 * Everything a chart needs, for the theme currently on screen.
 *
 * Series order is deliberate: violet reads first, magenta second, so a
 * two-series chart always uses the two most distinguishable hues.
 */
export function useChartTheme() {
  const { theme } = useTheme();
  const p = palettes[theme];

  return {
    palette: p,
    series: [p.primary, p.accent, p.success, p.warning, p.primaryDeep] as const,
    axis: {
      stroke: p.muted,
      gridDash: '3 3',
      // The grid is a whisper in both themes, but it has to be derived from
      // opposite ends: a light grid line on dark, a dark one on light.
      gridStroke: theme === 'dark' ? 'rgba(124,58,237,0.20)' : 'rgba(26,19,48,0.09)',
    },
    tooltip: {
      background: p.surface,
      border: `1px solid ${p.border}`,
      borderRadius: 12,
      color: p.text,
      fontSize: 12,
      // A white tooltip on a white card needs a shadow to separate; the dark
      // theme gets one too, since its surfaces are also close together.
      boxShadow:
        theme === 'dark'
          ? '0 8px 24px -12px rgba(0,0,0,0.6)'
          : '0 1px 2px rgba(26,19,48,0.04), 0 8px 24px -12px rgba(26,19,48,0.14)',
    },
  };
}
