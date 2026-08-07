/**
 * Design tokens in JavaScript form.
 * ─────────────────────────────────────────────────────────────────
 * Tailwind owns the palette for anything that takes a className. But
 * Recharts, canvas work and inline SVG gradients all need literal colour
 * values, and those had drifted: charts were drawing axes in #8B87A6 while
 * the `muted` token was #9B97B4, and the analytics page introduced a blue
 * (#3B82F6) that appears nowhere else in the product.
 *
 * Everything that needs a literal colour imports it from here, so the
 * palette has exactly one definition. Keep this in sync with
 * tailwind.config.ts — the values below are the same ones.
 */

export const palette = {
  bg:          '#0D0A1E',
  surface:     '#14102A',
  elevated:    '#1F1538',
  border:      'rgba(124,58,237,0.2)',
  text:        '#F8F5FF',
  muted:       '#9B97B4',
  subtle:      '#5C5878',
  primary:     '#A855F7',
  primaryDeep: '#7C3AED',
  accent:      '#EC4899',
  success:     '#10B981',
  warning:     '#F59E0B',
  danger:      '#EF4444',
} as const;

/**
 * Ordered series colours for charts.
 *
 * Drawn from the brand palette rather than picked per-chart, so a third
 * series looks intentional instead of arbitrary. Ordered for contrast
 * against the dark surface: violet reads first, magenta second.
 */
export const chartSeries = [
  palette.primary,
  palette.accent,
  palette.success,
  palette.warning,
  palette.primaryDeep,
] as const;

/** Shared Recharts axis/grid styling so every chart matches. */
export const chartAxis = {
  stroke:   palette.muted,
  gridDash: '3 3',
  gridStroke: 'rgba(124,58,237,0.12)',
} as const;

/** Recharts <Tooltip> contentStyle — matches Card surfaces. */
export const chartTooltip = {
  background:   palette.surface,
  border:       `1px solid ${palette.border}`,
  borderRadius: 12,
  color:        palette.text,
  fontSize:     12,
} as const;
