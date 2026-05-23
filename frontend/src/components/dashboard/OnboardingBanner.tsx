'use client';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAuth } from '@/store/auth';

export function OnboardingBanner() {
  const { user } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Check dismissal preference (per-session only — don't permanently hide)
    const hidden = sessionStorage.getItem('onboarding_banner_dismissed');
    if (hidden) setDismissed(true);
  }, []);

  // Only show if user exists, not onboarded, and not dismissed
  if (!user || user.onboarding_completed || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem('onboarding_banner_dismissed', '1');
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        className="relative rounded-2xl p-5 bg-gradient-to-r from-primary/15 via-accent/10 to-primary/15 border border-primary/30 mb-6"
      >
        <button
          onClick={dismiss}
          className="absolute top-3 right-3 text-muted hover:text-text transition"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
        <div className="flex items-center gap-4 flex-wrap pr-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
            <Sparkles size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium">Finish setting up your account</div>
            <div className="text-sm text-muted mt-0.5">Complete your profile so we can personalise your experience.</div>
          </div>
          <Link
            href="/onboarding"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition shrink-0"
          >
            Complete <ArrowRight size={14} />
          </Link>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
