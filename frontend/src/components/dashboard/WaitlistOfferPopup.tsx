'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Gift, X, ArrowRight, Copy, Check } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/store/auth';

interface DiscountCode {
  code: string;
  discount_type: 'first_month_free' | 'six_month_50pct';
  discount_pct: number | null;
  free_months: number | null;
  is_used: boolean;
  expires_at: string;
}

const STORAGE_KEY = 'omlive_waitlist_popup_dismissed';

export function WaitlistOfferPopup() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    // Only show for waitlist members who haven't dismissed it this session
    if (!user?.waitlist_member) return;
    const dismissed = sessionStorage.getItem(STORAGE_KEY);
    if (dismissed) return;

    // Fetch their codes
    api.get('/billing/my-codes')
      .then((res) => {
        const all: DiscountCode[] = res.data?.data ?? [];
        const unused = all.filter((c) => !c.is_used && new Date(c.expires_at) > new Date());
        if (unused.length > 0) {
          setCodes(unused);
          // Small delay so dashboard loads first, then popup slides in
          setTimeout(() => setShow(true), 1200);
        }
      })
      .catch(() => {});
  }, [user]);

  const dismiss = () => {
    sessionStorage.setItem(STORAGE_KEY, '1');
    setShow(false);
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  const labelFor = (c: DiscountCode) =>
    c.discount_type === 'first_month_free'
      ? '🎁 1 Month FREE'
      : `💸 ${c.discount_pct}% off first 6 months`;

  return (
    <AnimatePresence>
      {show && (
        <>
          {/* Backdrop (mobile) — tapping outside closes */}
          <div
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px] sm:hidden"
            onClick={dismiss}
          />

          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
            className={[
              // Position: bottom-right on desktop, bottom-full-width on mobile
              'fixed z-50',
              'bottom-5 right-5 w-[340px]',
              'sm:bottom-6 sm:right-6',
              'max-sm:left-4 max-sm:right-4 max-sm:bottom-4 max-sm:w-auto',
              // Card style
              'rounded-2xl border border-primary/30',
              'bg-[#130d2a]/95 backdrop-blur-xl',
              'shadow-[0_8px_40px_rgba(139,92,246,0.25)]',
              'p-5',
            ].join(' ')}
          >
            {/* Close */}
            <button
              onClick={dismiss}
              className="absolute top-3.5 right-3.5 text-muted hover:text-text transition"
              aria-label="Dismiss offer"
            >
              <X size={16} />
            </button>

            {/* Header */}
            <div className="flex items-center gap-3 mb-4 pr-6">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
                <Gift size={18} className="text-white" />
              </div>
              <div>
                <div className="font-semibold text-sm leading-tight">Your waitlist reward is ready!</div>
                <div className="text-xs text-muted mt-0.5">Use these codes at checkout to claim your offer</div>
              </div>
            </div>

            {/* Codes */}
            <div className="space-y-2 mb-4">
              {codes.map((c) => (
                <div
                  key={c.code}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-primary font-medium mb-0.5">{labelFor(c)}</div>
                    <div className="font-mono text-sm font-semibold tracking-wider text-text truncate">{c.code}</div>
                  </div>
                  <button
                    onClick={() => copyCode(c.code)}
                    className="shrink-0 w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 flex items-center justify-center transition"
                    aria-label="Copy code"
                  >
                    {copied === c.code
                      ? <Check size={13} className="text-green-400" />
                      : <Copy size={13} className="text-muted" />}
                  </button>
                </div>
              ))}
            </div>

            {/* CTA */}
            <Link
              href="/dashboard/billing?offer=waitlist"
              onClick={dismiss}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition"
            >
              Go to Billing to redeem <ArrowRight size={14} />
            </Link>

            <p className="text-center text-[11px] text-subtle mt-2">
              Expires {new Date(codes[0]?.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
