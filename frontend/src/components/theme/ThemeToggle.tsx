'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { cn } from '@/lib/utils';

/**
 * Theme toggle.
 *
 * A single button rather than a segmented light/dark/system control: there are
 * two themes and no system option, so a switch with one job is honest about
 * that. The icon shows the theme you would move to, which is the convention
 * people already read correctly, and the label says it outright for anyone
 * using a screen reader.
 *
 * Kept deliberately quiet. The light theme's boldness is spent on the palette,
 * so this control stays a plain icon button that matches the other actions in
 * whichever bar it sits in.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme, ready } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      // Before the stored choice is read the button is inert: acting on it
      // earlier could write a value derived from a guessed state.
      disabled={!ready}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      className={cn(
        'relative w-10 h-10 rounded-xl grid place-items-center shrink-0',
        'text-muted hover:text-text hover:bg-veil/5 border border-transparent hover:border-border',
        'transition-colors disabled:opacity-40',
        className
      )}
    >
      {/* Sized wrapper so the absolutely positioned icons have somewhere to
          sit while one leaves and the other arrives. */}
      <span className="relative w-[18px] h-[18px]">
        <AnimatePresence initial={false} mode="wait">
          <motion.span
            key={theme}
            // The icons rotate through each other rather than cross-fading —
            // a small nod to the sun and moon trading places.
            initial={{ opacity: 0, rotate: -75, scale: 0.7 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 75, scale: 0.7 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute inset-0 grid place-items-center"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </motion.span>
        </AnimatePresence>
      </span>
    </button>
  );
}
