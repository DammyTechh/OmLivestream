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

function CallbackContent() {
  const params    = useSearchParams();
  const reference = params.get('reference') ?? params.get('trxref');
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
