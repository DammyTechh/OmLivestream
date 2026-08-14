'use client';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { paymentUrl } from '@/lib/surface-links';

/**
 * Shown in place of a feature the current plan does not include.
 *
 * Deliberately a plain statement and one action, not a sales page: someone who
 * clicked into AI Studio wanted to use AI Studio, and the useful thing is to
 * say plainly that it is a Premium feature and offer the one link that changes
 * that. No badge, no decorative icon set, no urgency copy.
 */
export function PremiumGate({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card className="py-14 px-6 text-center max-w-lg mx-auto">
      <div className="w-11 h-11 rounded-xl bg-veil/[0.06] border border-border flex items-center justify-center mx-auto mb-5">
        <Lock size={18} className="text-muted" />
      </div>
      <h2 className="font-display text-xl font-semibold mb-2">{title}</h2>
      <p className="text-sm text-muted leading-relaxed mb-6 max-w-sm mx-auto">{description}</p>
      <Link
        href={paymentUrl('?plan=premium')}
        className="inline-block px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition"
      >
        Upgrade to Premium
      </Link>
    </Card>
  );
}
