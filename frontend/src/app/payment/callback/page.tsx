'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Loader2, AlertCircle } from 'lucide-react';
import { api, unwrap } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { DASHBOARD_URL, SUPPORT_EMAIL } from '@/lib/urls';

type State = 'checking' | 'active' | 'pending';

/**
 * Schemes this page may hand control back to.
 *
 * The mobile app opens checkout here and waits for a redirect to its own
 * scheme. Anything outside this list is ignored and the browser simply stays
 * put — the parameter arrives in a URL a user could edit, so redirecting
 * wherever it points would let an attacker route a completed payment's
 * callback to a host they control.
 */
const APP_RETURN_PREFIXES = ['omlivestream://'];
const DEV_RETURN = /^(exp:\/\/[\w.:-]+\/--\/|exp\+[\w-]+:\/\/)/;

function safeAppReturn(url: string | null): string | null {
  if (!url) return null;
  if (APP_RETURN_PREFIXES.some((p) => url.startsWith(p))) return url;
  // Expo Go during development only — never on the live site.
  if (process.env.NODE_ENV !== 'production' && DEV_RETURN.test(url)) return url;
  return null;
}

function CallbackContent() {
  const params    = useSearchParams();
  const reference = params.get('reference') ?? params.get('trxref');
  const appReturn = safeAppReturn(params.get('app_return'));
  const [state, setState] = useState<State>('checking');

  // Paystack redirects here right after payment, but the subscription is
  // activated by the server-side webhook. Poll our own subscription state
  // rather than trusting the redirect — the webhook may land a moment later.
  useEffect(() => {
    let cancelled = false;
    let attempts  = 0;

    const poll = async () => {
      try {
        const data = unwrap<{ currentPlan?: string }>(await api.get('/billing/dashboard'));
        if (cancelled) return;
        if (data?.currentPlan && data.currentPlan !== 'free') {
          setState('active');
          return;
        }
      } catch {
        // fall through to retry
      }
      if (cancelled) return;
      if (++attempts >= 5) {
        setState('pending');
        return;
      }
      setTimeout(poll, 2000);
    };

    poll();
    return () => { cancelled = true; };
  }, []);

  /**
   * Hand back to the app once the outcome is known.
   *
   * Only after polling settles, so the app is told what actually happened
   * rather than "we redirected you somewhere". `pending` is its own status
   * because a slow webhook is not a failure — the app shows "processing"
   * rather than telling someone their payment failed when it did not.
   */
  useEffect(() => {
    if (!appReturn || state === 'checking') return;
    const sep = appReturn.includes('?') ? '&' : '?';
    const url = `${appReturn}${sep}status=${state}` +
                (reference ? `&reference=${encodeURIComponent(reference)}` : '');
    // A short beat so the result is visible for a moment before the browser
    // closes — an instant dismissal reads as though nothing happened.
    const timer = setTimeout(() => { window.location.href = url; }, 900);
    return () => clearTimeout(timer);
  }, [appReturn, state, reference]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-20">
      <Card className="max-w-md w-full text-center p-10">
        {state === 'checking' && (
          <>
            <Loader2 className="mx-auto mb-4 animate-spin text-primary" size={40} />
            <h1 className="text-xl font-bold mb-2">Confirming your payment…</h1>
            <p className="text-muted text-sm">This usually takes a few seconds.</p>
          </>
        )}

        {state === 'active' && (
          <>
            <CheckCircle2 className="mx-auto mb-4 text-emerald-500" size={48} />
            <h1 className="text-xl font-bold mb-2">You&apos;re on Premium</h1>
            <p className="text-muted text-sm mb-6">
              Your subscription is active. Every platform is unlocked.
            </p>
            <Link href={`${DASHBOARD_URL}/dashboard`}>
              <Button className="w-full">Go to Dashboard →</Button>
            </Link>
          </>
        )}

        {state === 'pending' && (
          <>
            <AlertCircle className="mx-auto mb-4 text-amber-500" size={44} />
            <h1 className="text-xl font-bold mb-2">Payment received</h1>
            <p className="text-muted text-sm mb-2">
              We&apos;re still activating your subscription. This can take up to a
              minute — refresh your billing page shortly.
            </p>
            {reference && (
              <p className="text-muted text-xs mb-6 font-mono break-all">
                Reference: {reference}
              </p>
            )}
            <Link href={`${DASHBOARD_URL}/dashboard/billing`}>
              <Button className="w-full">View Billing</Button>
            </Link>
            <p className="text-muted text-xs mt-4">
              Still not active?{' '}
              <a className="text-primary" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>
            </p>
          </>
        )}
      </Card>
    </main>
  );
}

export default function PaymentCallbackPage() {
  return (
    <AuthGuard>
      <Suspense fallback={null}>
        <CallbackContent />
      </Suspense>
    </AuthGuard>
  );
}
