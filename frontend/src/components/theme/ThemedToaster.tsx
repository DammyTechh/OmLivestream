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
        duration: 4000,
        style: {
          background: 'rgb(var(--c-surface))',
          color: 'rgb(var(--c-text))',
          border: '1px solid rgb(var(--c-border))',
          // A white card on a white page needs a shadow to read as raised;
          // the token already carries the right weight per theme.
          boxShadow: 'var(--shadow-card)',
          // Messages are sentences, not labels: give them room to wrap and a
          // comfortable measure instead of one cramped line. The default
          // padding also sat the text hard against the icon.
          borderRadius: '12px',
          padding: '12px 16px',
          fontSize: '14px',
          lineHeight: '1.5',
          maxWidth: '380px',
        },
        success: { iconTheme: { primary: 'rgb(var(--c-primary))', secondary: '#FFFFFF' } },
        error:   { iconTheme: { primary: 'rgb(var(--c-danger))',  secondary: '#FFFFFF' } },
      }}
    />
  );
}
