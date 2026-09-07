'use client';
import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * A confirmation dialog that belongs to the product.
 *
 * `window.confirm()` renders an operating-system alert — grey, unstyled, with
 * the browser's own "dashboard.omlivestream.com says" prefix and OS buttons.
 * Next to a considered interface it reads as a bug, and on a screen where the
 * action is destructive it gives the user no signal about severity.
 *
 * Exposed as a promise so call sites keep the shape they already had:
 *
 *     if (!(await confirm({ title: 'Delete this recording?' }))) return;
 *
 * which is a one-word change from `if (!confirm('…')) return;` and preserves
 * the early-return style every handler is written in.
 */

interface ConfirmOptions {
  title: string;
  message?: string;
  /** Defaults to "Confirm". */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red styling and a warning mark, for anything irreversible. */
  destructive?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ title: '' });
  // Held in a ref because the promise is created in one render and settled in
  // another; state would be stale by the time the buttons are clicked.
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    setOpen(true);
    return new Promise<boolean>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (value: boolean) => {
    setOpen(false);
    resolver.current?.(value);
    resolver.current = null;
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              // Dismissing by clicking away always cancels. A destructive
              // action must never be the outcome of a stray click.
              onClick={() => settle(false)}
              className="fixed inset-0 z-[200] bg-veil/50 backdrop-blur-sm"
            />
            <div className="fixed inset-0 z-[201] flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
              <motion.div
                role="alertdialog"
                aria-modal="true"
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto relative w-full sm:w-[min(92vw,420px)]
                           rounded-t-2xl sm:rounded-2xl bg-surface border border-border shadow-2xl
                           p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
              >
                <button
                  onClick={() => settle(false)}
                  aria-label="Cancel"
                  className="absolute top-4 right-4 text-muted hover:text-text transition"
                >
                  <X size={17} />
                </button>

                <div className="flex gap-3.5">
                  {opts.destructive && (
                    <div className="w-9 h-9 rounded-xl bg-danger/12 flex items-center justify-center shrink-0">
                      <AlertTriangle size={18} className="text-danger" />
                    </div>
                  )}
                  <div className="min-w-0 pr-6">
                    <h2 className="font-display text-lg font-semibold leading-snug">{opts.title}</h2>
                    {opts.message && (
                      <p className="text-sm text-muted mt-1.5 leading-relaxed">{opts.message}</p>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 mt-6">
                  <Button variant="secondary" onClick={() => settle(false)} className="flex-1">
                    {opts.cancelLabel ?? 'Cancel'}
                  </Button>
                  <Button
                    variant={opts.destructive ? 'danger' : 'primary'}
                    onClick={() => settle(true)}
                    className="flex-1"
                    autoFocus
                  >
                    {opts.confirmLabel ?? 'Confirm'}
                  </Button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

/**
 * Falls back to window.confirm if the provider is absent.
 *
 * A missing provider should degrade to the old behaviour rather than throw —
 * losing the styling is a blemish, but a destructive action silently doing
 * nothing because a hook threw is a defect.
 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  return ctx ?? (async (o) => window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title));
}
