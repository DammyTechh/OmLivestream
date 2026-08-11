'use client';

/**
 * OAuth landing page.
 * ─────────────────────────────────────────────────────────────────
 * The provider redirects the browser to the API, which finishes the exchange
 * server-side and forwards here with a one-time ticket. This page trades that
 * ticket for the token pair and stores it on the frontend origin — which is
 * the whole reason for the extra hop. Tokens in the redirect URL would be
 * written to browser history and leaked in the Referer header of whatever the
 * user loads next.
 */

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { api, getApiError, unwrap } from '@/lib/api';
import { useAuth } from '@/store/auth';
import toast from 'react-hot-toast';

type Status = 'working' | 'declined' | 'failed';

const LABEL: Record<string, string> = {
  google: 'Google', facebook: 'Facebook', instagram: 'Instagram',
  tiktok: 'TikTok', twitch: 'Twitch',
};

function CallbackInner() {
  const router       = useRouter();
  const params       = useSearchParams();
  const { setTokens, refreshProfile } = useAuth();
  const [status, setStatus]   = useState<Status>('working');
  const [message, setMessage] = useState('Finishing sign-in…');

  // React 18 StrictMode mounts effects twice in development. The ticket is
  // single-use, so the second run would redeem an already-spent ticket and
  // show a failure on a sign-in that actually worked.
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const ticket   = params.get('ticket');
    const provider = params.get('provider') ?? '';
    const failure  = params.get('status');
    const label    = LABEL[provider] ?? 'that account';

    if (failure === 'declined') {
      setStatus('declined');
      setMessage(`You cancelled the ${label} sign-in. Nothing was shared with us.`);
      return;
    }
    if (failure || !ticket) {
      setStatus('failed');
      setMessage(`We couldn't complete your ${label} sign-in. Please try again, or use your email instead.`);
      return;
    }

    (async () => {
      try {
        const data = unwrap<{
          accessToken: string; refreshToken: string; isNewUser: boolean; needsEmail: boolean;
        }>(await api.post('/auth/social/exchange', { ticket }));

        setTokens(data.accessToken, data.refreshToken);
        await refreshProfile();

        // The provider gave us a placeholder address — Instagram and TikTok
        // never disclose one. Onboarding collects a real address before
        // anything tries to email this account.
        if (data.needsEmail) {
          toast.success(`Signed in with ${label}`);
          router.replace('/onboarding?collect=email');
          return;
        }

        toast.success(data.isNewUser ? 'Welcome to OmliveStream!' : 'Welcome back');
        router.replace(data.isNewUser ? '/onboarding' : '/dashboard');
      } catch (err) {
        setStatus('failed');
        setMessage(getApiError(err, `We couldn't complete your ${label} sign-in. Please try again.`));
      }
    })();
  }, [params, router, setTokens, refreshProfile]);

  return (
    <AuthLayout>
      <div className="text-center py-10">
        <h1 className="text-2xl font-semibold mb-2">
          {status === 'working' ? 'Signing you in' : 'Sign-in incomplete'}
        </h1>

        {status === 'working' ? (
          <div className="w-10 h-10 mx-auto border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        ) : null}

        <p className="mt-6 text-sm text-muted">{message}</p>

        {status !== 'working' && (
          <div className="mt-8 flex flex-col gap-3">
            <Link
              href="/auth/signin"
              className="h-12 rounded-xl bg-primary text-white font-medium flex items-center justify-center hover:opacity-90 transition"
            >
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}

export default function AuthCallbackPage() {
  // useSearchParams needs a Suspense boundary or the whole route opts out of
  // static rendering at build time.
  return (
    <Suspense fallback={null}>
      <CallbackInner />
    </Suspense>
  );
}
