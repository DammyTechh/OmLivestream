import { Platform } from 'react-native';

/**
 * Design tokens, carried over from the web app.
 *
 * The values are deliberately the same hex codes the website uses, so the two
 * products read as one brand rather than two things built by different people.
 * What changes is the *treatment*, not the palette: native gets platform
 * materials (blur, haptics, system easing) that a browser cannot do well.
 *
 * The restraint is intentional and hard-won. One brand violet does all the
 * work; colour is never used decoratively, only to mean something — live,
 * destructive, success. Every icon is a single-weight outline. That is what
 * separates an app that looks considered from one that looks like a template.
 */

export const palette = {
  // Brand — one violet, used sparingly.
  primary:      '#6D28D9',
  primaryHover: '#5B21B6',
  primarySoft:  'rgba(109, 40, 217, 0.12)',

  // Semantic. These are the only other colours allowed to appear.
  live:    '#E5484D',
  success: '#10B981',
  warning: '#F59E0B',
} as const;

/**
 * The colour contract both themes satisfy.
 *
 * Declared explicitly rather than inferred from one of them: `as const` makes
 * every value a string *literal* type, so `dark` and `light` would not be
 * assignable to each other and a component typed against one could not accept
 * the other. Naming the shape once keeps them interchangeable and makes a
 * missing token in either a compile error.
 */
export interface ThemeColors {
  bg: string; surface: string; surfaceAlt: string; border: string;
  text: string; textMuted: string; overlay: string;
  primary: string; primaryHover: string; primarySoft: string;
  live: string; success: string; warning: string;
}

export const dark: ThemeColors = {
  bg:        '#0A0818',
  surface:   '#141024',
  surfaceAlt:'#1B1630',
  border:    'rgba(255, 255, 255, 0.10)',
  text:      '#F8F5FF',
  textMuted: '#8B84A3',
  overlay:   'rgba(10, 8, 24, 0.72)',
  ...palette,
};

export const light: ThemeColors = {
  bg:        '#F6F4FA',
  surface:   '#FFFFFF',
  surfaceAlt:'#FAF9FD',
  border:    'rgba(20, 16, 36, 0.10)',
  text:      '#141024',
  textMuted: '#605A75',
  overlay:   'rgba(20, 16, 36, 0.55)',
  ...palette,
};

export type Theme = ThemeColors;

/**
 * Spacing on a 4pt grid.
 *
 * A fixed scale rather than arbitrary numbers: it is what stops a screen built
 * on Tuesday from being subtly out of rhythm with one built on Friday.
 */
export const space = {
  xs: 4, sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, '3xl': 32, '4xl': 40, '5xl': 56,
} as const;

export const radius = {
  sm: 8, md: 12, lg: 16, xl: 20, '2xl': 24, full: 999,
} as const;

/**
 * Type scale.
 *
 * System fonts on both platforms, deliberately. San Francisco and Roboto are
 * the faces users already read all day; they render at every weight, ship no
 * bytes, and support every language the OS does. A bundled display face on a
 * phone mostly signals "app" when the goal is for the product to feel native.
 */
export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700' as const, letterSpacing: -0.6 },
  h1:      { fontSize: 24, lineHeight: 30, fontWeight: '700' as const, letterSpacing: -0.4 },
  h2:      { fontSize: 19, lineHeight: 25, fontWeight: '600' as const, letterSpacing: -0.2 },
  h3:      { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body:    { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  bodyMed: { fontSize: 15, lineHeight: 22, fontWeight: '500' as const },
  small:   { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  caption: { fontSize: 11, lineHeight: 15, fontWeight: '500' as const, letterSpacing: 0.2 },
  mono:    {
    fontSize: 13,
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
  },
} as const;

/**
 * Elevation.
 *
 * iOS gets a soft ambient shadow; Android gets its own elevation because a
 * hand-rolled shadow there looks wrong against system surfaces.
 */
export const shadow = (level: 1 | 2 | 3 = 1) =>
  Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOpacity: [0.10, 0.16, 0.22][level - 1],
      shadowRadius: [8, 16, 28][level - 1],
      shadowOffset: { width: 0, height: [2, 6, 12][level - 1] },
    },
    android: { elevation: [2, 6, 12][level - 1] },
    default: {},
  })!;

/**
 * Motion.
 *
 * Short and unfussy. Anything past ~250ms starts to feel like the app is
 * thinking rather than responding.
 */
export const motion = {
  fast: 150,
  base: 220,
  slow: 320,
} as const;

/** Minimum tappable size. 44pt is Apple's floor; Android's is 48dp. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = Platform.OS === 'ios' ? 44 : 48;
