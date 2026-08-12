import type { Config } from 'tailwindcss';

/**
 * Every colour resolves through a CSS variable holding three sRGB channels
 * (see src/styles/globals.css), so a single class works in both themes.
 *
 * The `<alpha-value>` placeholder is the load-bearing detail. Tailwind
 * substitutes it with whatever opacity modifier the class carries, so
 * `bg-surface/50` compiles to `rgb(var(--c-surface) / 0.5)`. Writing
 * `'rgb(var(--c-surface))'` without it would silently drop the modifier and
 * every `/N` usage in the product — there are ~140 — would render fully
 * opaque instead.
 *
 * `veil` is a polarity-flipping scrim rather than a colour: white over dark
 * surfaces, near-black over light ones. It replaces the `white/N` idiom, which
 * composites to nothing on a white card.
 */
const channel = (v: string) => `rgb(var(${v}) / <alpha-value>)`;

const config: Config = {
  // Light is the default and lives on :root; `.dark` on <html> opts in.
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:        channel('--c-bg'),
        surface:   channel('--c-surface'),
        elevated:  channel('--c-elevated'),
        border:    channel('--c-border'),
        text:      channel('--c-text'),
        muted:     channel('--c-muted'),
        subtle:    channel('--c-subtle'),
        primary:   channel('--c-primary'),
        'primary-deep': channel('--c-primary-deep'),
        accent:    channel('--c-accent'),
        success:   channel('--c-success'),
        warning:   channel('--c-warning'),
        severe:    channel('--c-severe'),
        danger:    channel('--c-danger'),
        veil:      channel('--c-veil'),
      },
      boxShadow: {
        brand:       'var(--shadow-brand)',
        'brand-lg':  'var(--shadow-brand-hover)',
        card:        'var(--shadow-card)',
      },
      fontFamily: {
        display: ['var(--font-fraunces)', 'serif'],
        sans:    ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-8px)' },
        },
      },
    },
  },
  plugins: [],
};
export default config;
