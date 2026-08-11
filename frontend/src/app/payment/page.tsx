'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Check, CreditCard, ShieldCheck, ArrowLeft, Info, Tag } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Navbar } from '@/components/landing/Navbar';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { api, getApiError, unwrap } from '@/lib/api';
import { PREMIUM_PRICE, WAITLIST_DISCOUNT_PCT, WAITLIST_DISCOUNT_MONTHS, naira } from '@/lib/pricing';

function PaymentContent() {
  const params = useSearchParams();
  const [cycle, setCycle]  = useState<'monthly' | 'annual'>((params.get('cycle') as 'monthly' | 'annual') || 'monthly');
  const [loading, setLoading] = useState(false);
  const [loadingMethod, setLoadingMethod] = useState<'card' | 'google_pay' | null>(null);
  const [discountCode, setDiscountCode] = useState(params.get('code') || '');

  const price = PREMIUM_PRICE;
  const total = price[cycle];

  const paystackCheckout = async (paymentMethod: 'card' | 'google_pay') => {
    setLoading(true);
    setLoadingMethod(paymentMethod);
    try {
      const data = unwrap<{ paystackAuthUrl: string; reference: string }>(
        await api.post('/billing/subscribe', {
          plan: 'premium',
          billingCycle: cycle,
          paymentMethod,
          discountCode: discountCode.trim() || undefined,
        })
      );
      window.location.href = data.paystackAuthUrl;
    } catch (err) {
      toast.error(getApiError(err, "We couldn't start checkout. Please try again."));
      setLoading(false);
      setLoadingMethod(null);
    }
  };

  const features = [
    'Access to all 8 supported streaming platforms simultaneously',
    'Full audience engagement — reply to comments across all platforms',
    'Advanced video filters and quality controls',
    'Full analytics dashboard with platform-level comparisons',
    'Complete stream customization — overlays, banners, lower-thirds',
  ];

  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-10 pb-20 relative">
        <div className="relative mx-auto max-w-6xl px-6">
          <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text mb-6">
            <ArrowLeft size={14} /> Back to dashboard
          </Link>

          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-8">
            {/* LEFT: Payment methods */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              <Card className="p-8">
                <div className="flex items-baseline justify-between mb-6">
                  <h2 className="font-display text-2xl font-semibold">Total</h2>
                  <div className="text-right">
                    <div className="font-display text-3xl font-semibold tracking-tight">₦{total.toLocaleString()}</div>
                    <div className="text-sm text-muted">/{cycle}</div>
                  </div>
                </div>

                {/* Security notice */}
                <div className="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/20 mb-6">
                  <ShieldCheck size={18} className="text-primary shrink-0 mt-0.5" />
                  <div className="text-xs text-muted leading-relaxed">
                    For your security, your card details are entered directly on <strong className="text-text">Paystack's secure checkout page</strong> — they never touch our servers. Choose a payment method below to continue.
                  </div>
                </div>

                {/* Google Pay */}
                <button
                  onClick={() => paystackCheckout('google_pay')}
                  disabled={loading}
                  className="w-full py-4 rounded-2xl bg-black text-white font-semibold mb-3 flex items-center justify-center gap-2 hover:bg-neutral-900 transition disabled:opacity-60 border border-white/10"
                >
                  {loadingMethod === 'google_pay'
                    ? 'Redirecting to Google Pay…'
                    : <>
                        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#4285F4" d="M47.5 24.5c0-1.7-.2-3.3-.4-4.9H24v9.3h13.2c-.6 3-2.3 5.5-4.8 7.2v6h7.7c4.5-4.1 7.4-10.2 7.4-17.6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.2 15.9-5.8l-7.7-6c-2.2 1.5-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.6-10H2.4v6.2C6.3 42.6 14.5 48 24 48z"/><path fill="#FBBC04" d="M10.4 28.5c-.5-1.5-.8-3.1-.8-4.5s.3-3 .8-4.5v-6.2H2.4C.9 16.5 0 20.2 0 24s.9 7.5 2.4 10.7l8-6.2z"/><path fill="#EA4335" d="M24 9.5c3.6 0 6.8 1.2 9.3 3.6l7-7C36 2.3 30.5 0 24 0 14.5 0 6.3 5.4 2.4 13.3l8 6.2c2-5.8 7.3-10 13.6-10z"/></svg>
                        Pay with Google Pay
                      </>
                  }
                </button>

                {/* Card */}
                <button
                  onClick={() => paystackCheckout('card')}
                  disabled={loading}
                  className="w-full py-4 rounded-2xl bg-primary text-white font-semibold mb-5 flex items-center justify-center gap-2 hover:bg-primary/90 transition disabled:opacity-60 shadow-lg shadow-primary/25"
                >
                  {loadingMethod === 'card'
                    ? 'Redirecting to secure checkout…'
                    : <><CreditCard size={18} /> Pay with card · {naira(total)}</>
                  }
                </button>

                {/* Discount code — restored */}
                <div className="pt-5 border-t border-white/5">
                  <label className="label flex items-center gap-2">
                    <Tag size={13} className="text-primary" />
                    Have a waitlist code or discount?
                  </label>
                  <div className="flex gap-2">
                    <input
                      value={discountCode}
                      onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                      placeholder="OMLS1FREE-XXXXXXXX"
                      className="input flex-1 font-mono text-sm"
                    />
                  </div>
                  <p className="text-xs text-muted mt-2 flex items-start gap-1.5">
                    <Info size={11} className="shrink-0 mt-0.5" />
                    Waitlist rewards only. <strong className="text-text">OMLS1FREE-…</strong> gives 1 month free — redeem it from Billing, not here.{' '}
                    <strong className="text-text">OMLS6DISC-…</strong> takes {WAITLIST_DISCOUNT_PCT}% off your first {WAITLIST_DISCOUNT_MONTHS} months and is applied to this payment.
                  </p>
                </div>
              </Card>
            </motion.div>

            {/* RIGHT: Plan summary */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
              <h1 className="font-display text-4xl font-semibold tracking-tight mb-3">Premium</h1>
              <p className="text-muted mb-8 leading-relaxed">
                Scale your influence with full engagement and pro-level customization.
              </p>

              <div className="space-y-3 mb-8">
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition ${cycle === 'monthly' ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.02]'}`}>
                  <input type="radio" checked={cycle === 'monthly'} onChange={() => setCycle('monthly')} className="accent-primary" />
                  <span className="flex-1 font-display font-semibold">{naira(price.monthly)} <span className="text-sm font-normal text-muted">/ month</span></span>
                </label>
                <label className={`flex items-center gap-3 p-4 rounded-2xl border cursor-pointer transition ${cycle === 'annual' ? 'border-primary bg-primary/10' : 'border-white/10 bg-white/[0.02]'}`}>
                  <input type="radio" checked={cycle === 'annual'} onChange={() => setCycle('annual')} className="accent-primary" />
                  <span className="flex-1 font-display font-semibold">{naira(price.annual)} <span className="text-sm font-normal text-muted">/ year</span></span>
                  <span className="text-xs text-muted">12 × {naira(price.monthly)}</span>
                </label>
              </div>

              <div className="space-y-3">
                {features.map((f, i) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <Check size={18} className="text-success shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </main>
    </>
  );
}

export default function PaymentPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading…</div>}>
        <PaymentContent />
      </Suspense>
    </AuthGuard>
  );
}
