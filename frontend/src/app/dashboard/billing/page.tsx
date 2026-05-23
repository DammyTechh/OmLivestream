'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Sparkles, CreditCard, Gift, Copy, Check, Tag, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { api, getApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatCurrency, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

interface Invoice {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt_url: string | null;
  created_at: string;
}

interface DiscountCode {
  code: string;
  discount_type: string;
  discount_pct: number | null;
  free_months: number | null;
  is_used: boolean;
  expires_at: string;
}

// ── Smart code redemption box ───────────────────────────────────────
function CodeRedeemBox({ onRedeemed }: { onRedeemed: () => void }) {
  const router = useRouter();
  const [input, setInput]           = useState('');
  const [validating, setValidating] = useState(false);
  const [redeeming, setRedeeming]   = useState(false);
  const [preview, setPreview]       = useState<{
    code: string;
    discountType: string;
    label: string;
    discountPct: number | null;
    freeMonths: number | null;
    expiresAt: string;
  } | null>(null);
  const [error, setError]           = useState('');

  // Validate on blur / when user stops typing
  const handleValidate = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setPreview(null); setError(''); return; }
    setValidating(true);
    setError('');
    setPreview(null);
    try {
      const res = await api.post('/billing/validate-code', { code: trimmed });
      setPreview(res.data?.data);
    } catch (err) {
      setError(getApiError(err, 'Invalid or expired code'));
    } finally {
      setValidating(false);
    }
  };

  // Redeem free code directly (no payment)
  const handleRedeem = async () => {
    if (!preview) return;
    setRedeeming(true);
    try {
      await api.post('/billing/redeem-code', { code: preview.code });
      toast.success('🎉 Premium activated! Enjoy your free month.');
      onRedeemed(); // refresh parent state
    } catch (err) {
      toast.error(getApiError(err, 'Could not redeem code. Please try again.'));
    } finally {
      setRedeeming(false);
    }
  };

  // Send discount code to payment page
  const handleGoToPayment = () => {
    if (!preview) return;
    router.push(`/payment?plan=premium&code=${preview.code}`);
  };

  const isFree     = preview?.discountType === 'first_month_free';
  const isDiscount = preview?.discountType === 'six_month_50pct';

  return (
    <Card className="p-6">
      <div className="flex items-center gap-2 mb-3">
        <Tag size={15} className="text-primary" />
        <h2 className="font-display text-base font-semibold">Have a waitlist or discount code?</h2>
      </div>

      {/* Input row */}
      <div className="flex gap-2 mb-3">
        <input
          value={input}
          onChange={(e) => { setInput(e.target.value.toUpperCase()); setPreview(null); setError(''); }}
          onBlur={() => handleValidate(input)}
          placeholder="e.g. OMLS1FREE-XXXXXXXX"
          className="input flex-1 font-mono text-sm"
        />
        <button
          onClick={() => handleValidate(input)}
          disabled={!input.trim() || validating}
          className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm font-medium text-muted hover:bg-white/10 transition disabled:opacity-40 whitespace-nowrap"
        >
          {validating ? <Loader2 size={14} className="animate-spin" /> : 'Check'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-danger mb-3">
          <AlertCircle size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Valid code preview */}
      {preview && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 mb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <div className="font-mono text-sm font-bold tracking-widest text-text mb-1">{preview.code}</div>
              <div className="text-sm text-primary font-medium mb-1">
                {isFree ? '🎁 1 Month FREE — Premium on us' : `💸 ${preview.discountPct}% off your first 6 months`}
              </div>
              <div className="text-xs text-muted">
                Expires {new Date(preview.expiresAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </div>
            </div>

            {/* Action — different per code type */}
            <div className="shrink-0">
              {isFree && (
                <button
                  onClick={handleRedeem}
                  disabled={redeeming}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition disabled:opacity-60"
                >
                  {redeeming
                    ? <><Loader2 size={14} className="animate-spin" /> Activating…</>
                    : <><Sparkles size={14} /> Activate Premium free</>}
                </button>
              )}
              {isDiscount && (
                <button
                  onClick={handleGoToPayment}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition"
                >
                  <ArrowRight size={14} /> Apply at checkout
                </button>
              )}
            </div>
          </div>

          {/* Explanation */}
          <p className="text-xs text-muted mt-3 pt-3 border-t border-white/10">
            {isFree
              ? '✅ This code gives you 1 month of Premium for free — no payment needed. Click Activate and it starts immediately.'
              : '💳 This discount code gives you 50% off for 6 months. It gets applied automatically at checkout on the payment page.'}
          </p>
        </div>
      )}
    </Card>
  );
}

// ── Main billing page ───────────────────────────────────────────────
function BillingContent() {
  const { user, refreshProfile } = useAuth();
  const searchParams = useSearchParams();
  const showOffer = searchParams.get('offer') === 'waitlist';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [codes, setCodes]       = useState<DiscountCode[]>([]);
  const [loading, setLoading]   = useState(true);
  const [copied, setCopied]     = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [inv, cod] = await Promise.all([
        api.get('/billing/invoices').then(r => r.data?.data || []).catch(() => []),
        user?.waitlist_member
          ? api.get('/billing/my-codes').then(r => r.data?.data || []).catch(() => [])
          : Promise.resolve([]),
      ]);
      setInvoices(inv);
      setCodes((cod as DiscountCode[]).filter((c) => !c.is_used && new Date(c.expires_at) > new Date()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, [user]);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    } catch {}
  };

  // Called after a free code is redeemed — refresh user plan + data
  const handleRedeemed = async () => {
    await refreshProfile().catch(() => {});
    await fetchData();
  };

  const isPremium      = user?.plan === 'premium';
  const firstUnusedCode = codes[0];

  const labelFor = (c: DiscountCode) =>
    c.discount_type === 'first_month_free'
      ? '🎁 1 month FREE — Premium on us'
      : `💸 ${c.discount_pct}% off your first 6 months`;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Billing & Plan</h1>
        <p className="text-muted mt-1">Manage your subscription and payment history.</p>
      </div>

      {/* Waitlist reward banner */}
      {(showOffer || codes.length > 0) && !isPremium && (
        <div className="rounded-2xl bg-gradient-to-br from-primary/20 via-accent/10 to-primary/5 border border-primary/40 p-6">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center shrink-0">
              <Gift size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="font-display text-lg font-semibold">Your waitlist rewards</h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary border border-primary/30">
                  {codes.length} unused
                </span>
              </div>
              <p className="text-sm text-muted mb-4">
                You joined the waitlist early — use your codes below. Free codes activate Premium instantly. Discount codes apply at checkout.
              </p>

              {/* Code cards */}
              <div className="grid sm:grid-cols-2 gap-3 mb-4">
                {codes.map((c) => (
                  <div
                    key={c.code}
                    className="flex items-center justify-between gap-3 rounded-xl bg-black/20 border border-white/10 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs text-primary font-medium mb-1">{labelFor(c)}</div>
                      <div className="font-mono text-base font-bold tracking-widest text-text">{c.code}</div>
                      <div className="text-[11px] text-subtle mt-1">
                        Expires {new Date(c.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </div>
                    </div>
                    <button
                      onClick={() => copyCode(c.code)}
                      className="shrink-0 w-8 h-8 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 flex items-center justify-center transition"
                      aria-label="Copy code"
                    >
                      {copied === c.code
                        ? <Check size={14} className="text-green-400" />
                        : <Copy size={14} className="text-muted" />}
                    </button>
                  </div>
                ))}
              </div>

              <Link href={`/payment?plan=premium${firstUnusedCode ? `&code=${firstUnusedCode.code}` : ''}`}>
                <Button icon={<Sparkles size={16} />}>Upgrade &amp; apply reward</Button>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Current plan card */}
      <Card className={`p-8 ${isPremium ? 'bg-gradient-to-br from-primary/15 to-accent/10 border-primary/40' : ''}`}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              {isPremium && <Sparkles size={16} className="text-primary" />}
              <span className="text-xs uppercase tracking-widest text-muted">Current Plan</span>
            </div>
            <h2 className="font-display text-4xl font-semibold tracking-tight capitalize mb-2">
              {user?.plan?.replace('_', ' ')}
            </h2>
            <p className="text-muted max-w-md">
              {isPremium
                ? 'You have full access to all features. Stream to all 8 platforms simultaneously.'
                : "You're on the free plan. Upgrade to unlock premium features."}
            </p>
          </div>
          {!isPremium && (
            <Link href={`/payment?plan=premium${firstUnusedCode ? `&code=${firstUnusedCode.code}` : ''}`}>
              <Button icon={<Sparkles size={16} />}>
                {firstUnusedCode ? 'Upgrade with your reward' : 'Upgrade to Premium'}
              </Button>
            </Link>
          )}
        </div>
      </Card>

      {/* Smart code redemption box — only for free users */}
      {!isPremium && <CodeRedeemBox onRedeemed={handleRedeemed} />}

      {/* Invoices */}
      <div>
        <h2 className="font-display text-xl font-semibold mb-3">Payment history</h2>
        {loading ? (
          <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
        ) : invoices.length === 0 ? (
          <Card className="py-14 text-center">
            <CreditCard size={40} className="text-muted mx-auto mb-4" />
            <h3 className="font-display text-xl mb-2">No invoices yet</h3>
            <p className="text-muted">Your payment history will appear here.</p>
          </Card>
        ) : (
          <div className="grid gap-2">
            {invoices.map((inv) => (
              <Card key={inv.id} className="p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium">{formatCurrency(inv.amount)}</div>
                    <div className="text-xs text-muted">{formatDate(inv.created_at)} · Ref: {inv.id.slice(0, 12)}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2.5 py-1 rounded-full ${
                      inv.status === 'paid'    ? 'bg-success/20 text-success' :
                      inv.status === 'pending' ? 'bg-warning/20 text-warning' : 'bg-danger/20 text-danger'
                    }`}>
                      {inv.status}
                    </span>
                    {inv.receipt_url && (
                      <a href={inv.receipt_url} target="_blank" className="text-xs text-primary hover:underline">Receipt →</a>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<div className="h-40 flex items-center justify-center text-muted">Loading…</div>}>
      <BillingContent />
    </Suspense>
  );
}