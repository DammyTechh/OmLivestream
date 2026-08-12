'use client';

import { Toaster } from 'react-hot-toast';

/**
 * Toasts, themed.
 *
 * react-hot-toast styles via inline `style`, so it cannot use Tailwind classes
 * — and the previous hardcoded `#14102A` background left dark text on a dark
 * panel once the rest of the product went light.
 *
 * Passing `rgb(var(--c-surface))` works because inline styles resolve CSS
 * variables at paint time against the element's inherited values. The toast is
 * rendered inside <body>, so it inherits from :root and follows the theme with
 * no JavaScript and no re-render on toggle.
 */
export function ThemedToaster() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'rgb(var(--c-surface))',
          color: 'rgb(var(--c-text))',
          border: '1px solid rgb(var(--c-border))',
          // A white card on a white page needs a shadow to read as raised;
          // the token already carries the right weight per theme.
          boxShadow: 'var(--shadow-card)',
        },
        success: { iconTheme: { primary: 'rgb(var(--c-primary))', secondary: '#FFFFFF' } },
        error:   { iconTheme: { primary: 'rgb(var(--c-danger))',  secondary: '#FFFFFF' } },
      }}
    />
  );
}
