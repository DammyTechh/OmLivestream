'use client';

/**
 * Collects a real email for accounts created through a provider that gives us
 * none — Instagram and TikTok disclose no address at any scope, and Facebook
 * omits it for phone-only accounts. Those accounts hold a placeholder
 * `@social.omlivestream.invalid` address until this completes.
 *
 * The address is confirmed by code rather than simply accepted. An unverified
 * address on file is worse than a placeholder: it claims a mailbox the user
 * may not own, and email sign-in would then let whoever does own it into this
 * account.
 */

import { useState } from 'react';
import { Mail, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, getApiError, unwrap } from '@/lib/api';
import { useAuth } from '@/store/auth';

export function EmailClaimGate({ onDone }: { onDone: () => void }) {
  const { refreshProfile } = useAuth();
  const [phase, setPhase]     = useState<'email' | 'code'>('email');
  const [email, setEmail]     = useState('');
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);

  const sendCode = async () => {
    if (!email.includes('@')) return toast.error('Enter a valid email address');
    setLoading(true);
    try {
      await api.post('/auth/email/claim', { email });
      toast.success(`Code sent to ${email}`);
      setPhase('code');
    } catch (err) {
      toast.error(getApiError(err, 'Could not send the code'));
    } finally { setLoading(false); }
  };

  const confirm = async () => {
    if (code.length !== 6) return toast.error('Enter the 6-digit code');
    setLoading(true);
    try {
      unwrap<{ email: string }>(await api.post('/auth/email/claim/confirm', { code }));
      await refreshProfile();
      toast.success('Email confirmed');
      onDone();
    } catch (err) {
      toast.error(getApiError(err, 'That code was not accepted'));
    } finally { setLoading(false); }
  };

  return (
    <div className="max-w-md mx-auto text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
        <Mail size={24} className="text-primary" />
      </div>

      {phase === 'email' ? (
        <>
          <h2 className="text-2xl font-semibold mb-2">What&apos;s your email?</h2>
          <p className="text-sm text-muted mb-7">
            The account you signed in with doesn&apos;t share an email address with us.
            We need one for receipts, stream alerts, and getting you back in if you
            lose access.
          </p>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendCode()}
            placeholder="you@example.com"
            autoFocus
          />
          <Button className="w-full mt-5" onClick={sendCode} loading={loading} icon={<ArrowRight size={16} />}>
            Send code
          </Button>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-semibold mb-2">Enter the code</h2>
          <p className="text-sm text-muted mb-7">
            We sent a 6-digit code to <span className="text-text">{email}</span>.
          </p>
          <Input
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && confirm()}
            placeholder="000000"
            className="text-center tracking-[0.5em] text-lg"
            autoFocus
          />
          <Button className="w-full mt-5" onClick={confirm} loading={loading} icon={<ArrowRight size={16} />}>
            Confirm
          </Button>
          <button
            type="button"
            onClick={() => { setPhase('email'); setCode(''); }}
            className="mt-4 text-sm text-muted hover:text-text transition"
          >
            Use a different email
          </button>
        </>
      )}
    </div>
  );
}
