import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg:        '#0D0A1E',
        surface:   '#14102A',
        elevated:  '#1F1538',
        border:    'rgba(124,58,237,0.2)',
        text:      '#F8F5FF',
        muted:     '#9B97B4',
        subtle:    '#5C5878',
        primary:   '#A855F7',
        'primary-deep': '#7C3AED',
        accent:    '#EC4899',
        success:   '#10B981',
        warning:   '#F59E0B',
        danger:    '#EF4444',
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
