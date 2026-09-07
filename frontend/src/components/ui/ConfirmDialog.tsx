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

  /**
   * Ask for text as well as agreement.
   *
   * `window.prompt` is the other OS dialog this replaces, and it is worse
   * than confirm: no styling, no validation, and a single-line field with no
   * room for the multi-sentence instructions the AI editor needs.
   */
  input?: {
    label?: string;
    placeholder?: string;
    defaultValue?: string;
    /** Renders a textarea instead of a single line. */
    multiline?: boolean;
    /** Confirm stays disabled until this returns true. */
    validate?: (value: string) => boolean;
    /** Shown under the field when validate fails and something has been typed. */
    hint?: string;
  };
}

/** Resolves to the entered text, or null if cancelled. Boolean dialogs get true/null. */
type ConfirmFn = (opts: ConfirmOptions) => Promise<string | boolean | null>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions>({ title: '' });
  const [value, setValue] = useState('');
  // Held in a ref because the promise is created in one render and settled in
  // another; state would be stale by the time the buttons are clicked.
  const resolver = useRef<((v: string | boolean | null) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((o) => {
    setOpts(o);
    setValue(o.input?.defaultValue ?? '');
    setOpen(true);
    return new Promise<string | boolean | null>((resolve) => { resolver.current = resolve; });
  }, []);

  const settle = (ok: boolean) => {
    setOpen(false);
    // Cancelling is always null, so a caller can distinguish "dismissed" from
    // "confirmed with an empty field".
    resolver.current?.(ok ? (opts.input ? value : true) : null);
    resolver.current = null;
  };

  const valid = !opts.input?.validate || opts.input.validate(value);

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

                {opts.input && (
                  <div className="mt-5">
                    {opts.input.label && (
                      <label className="block text-xs font-medium text-muted mb-2">
                        {opts.input.label}
                      </label>
                    )}
                    {opts.input.multiline ? (
                      <textarea
                        autoFocus
                        rows={3}
                        value={value}
                        placeholder={opts.input.placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        className="w-full rounded-xl bg-veil/5 border border-border px-3.5 py-2.5
                                   text-sm outline-none focus:border-primary transition resize-none"
                      />
                    ) : (
                      <input
                        autoFocus
                        value={value}
                        placeholder={opts.input.placeholder}
                        onChange={(e) => setValue(e.target.value)}
                        // Enter confirms a single-line field, which is what
                        // anyone typing into one expects.
                        onKeyDown={(e) => { if (e.key === 'Enter' && valid) settle(true); }}
                        className="w-full rounded-xl bg-veil/5 border border-border px-3.5 py-2.5
                                   text-sm outline-none focus:border-primary transition"
                      />
                    )}
                    {opts.input.hint && !valid && value.length > 0 && (
                      <p className="text-xs text-danger mt-2">{opts.input.hint}</p>
                    )}
                  </div>
                )}

                <div className="flex gap-2 mt-6">
                  <Button variant="secondary" onClick={() => settle(false)} className="flex-1">
                    {opts.cancelLabel ?? 'Cancel'}
                  </Button>
                  <Button
                    variant={opts.destructive ? 'danger' : 'primary'}
                    onClick={() => settle(true)}
                    className="flex-1"
                    disabled={!valid}
                    autoFocus={!opts.input}
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
  return ctx ?? (async (o) => {
    if (o.input) return window.prompt(o.title, o.input.defaultValue ?? '');
    return window.confirm(o.message ? `${o.title}\n\n${o.message}` : o.title) ? true : null;
  });
}
