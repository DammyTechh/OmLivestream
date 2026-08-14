'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { PREMIUM_PRICE, naira } from '@/lib/pricing';
import { paymentUrl } from '@/lib/surface-links';

const FREE_FEATURES = [
  'Access to a maximum of 2 streaming platforms',
  'Ability to go live and stream content',
  'View viewer counts and basic statistics',
  'View comments in read-only mode (replies not available)',
  'Advanced video editing and customization tools are not included',
];

const PREMIUM_FEATURES = [
  'Access to all 8 supported streaming platforms simultaneously',
  'Full audience engagement: reply to comments across all platforms',
  'Advanced video filters and quality controls',
  'Full analytics dashboard with platform-level comparisons',
  'Complete stream customization including overlays, banners, and lower thirds',
];

export function Pricing() {
  return (
    <section id="pricing" className="relative py-28">
      <div className="mx-auto max-w-5xl px-6">
        <div className="text-center mb-14">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-display text-4xl md:text-5xl font-semibold tracking-tight"
          >
            Scalable Plans for Every Creator.
          </motion.h2>
          <p className="mt-5 text-[15px] text-muted max-w-xl mx-auto">
            From hobbyist streaming to professional broadcasting, choose the plan that gives you full control over your global audience.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5 max-w-4xl mx-auto">
          {/* Free plan */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="relative rounded-[28px] p-8 bg-surface/60 border border-border"
          >
            <h3 className="font-display text-2xl font-semibold mb-4">Free</h3>
            <div className="mb-5">
              <span className="font-display text-5xl font-semibold tracking-tight line-through text-text/70">₦0</span>
              <span className="text-muted text-lg">/month</span>
            </div>
            <p className="text-[15px] text-text/90 mb-8 font-medium">Essential features to start your streaming journey.</p>

            <div className="space-y-3 mb-10">
              {FREE_FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <Check size={16} className="text-primary/70 shrink-0 mt-0.5" />
                  <span className="text-muted">{f}</span>
                </div>
              ))}
            </div>

            <button
              className="w-full py-3.5 rounded-2xl bg-elevated/60 border border-border text-muted font-semibold cursor-not-allowed"
              disabled
            >
              Current Plan
            </button>
          </motion.div>

          {/* Premium plan */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="relative rounded-[28px] p-8 bg-surface/60 border border-primary/30 shadow-2xl shadow-primary/10"
          >
            <h3 className="font-display text-2xl font-semibold mb-4">Premium</h3>
            <div className="mb-3">
              <span className="font-display text-5xl font-semibold tracking-tight">{naira(PREMIUM_PRICE.monthly)}</span>
              <span className="text-muted text-lg">/month</span>
            </div>
            {/* No strikethrough, no savings badge: annual is twelve monthly
                payments taken at once, at the same rate. The old "₦153,000
                (15% off)" advertised a discount nothing in the codebase
                applied. */}
            <div className="mb-5">
              <span className="text-muted text-sm">or {naira(PREMIUM_PRICE.annual)}/year — billed annually</span>
            </div>
            <p className="text-[15px] text-text/90 mb-8 font-medium">Scale your influence with full engagement and pro-level customization.</p>

            <div className="space-y-3 mb-10">
              {PREMIUM_FEATURES.map((f, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <Check size={16} className="text-primary shrink-0 mt-0.5" />
                  <span className="text-text">{f}</span>
                </div>
              ))}
            </div>

            <Link
              href={paymentUrl("?plan=premium")}
              className="block w-full py-3.5 text-center rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/25"
            >
              Choose this plan
            </Link>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
