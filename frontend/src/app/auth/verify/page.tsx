'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { dashboardUrl } from '@/lib/surface-links';
import { api, getApiError, unwrap } from '@/lib/api';
import { useAuth } from '@/store/auth';

// Envelope icon matching Figma illustration
function EnvelopeIllustration() {
  return (
    <div className="relative w-48 h-48 mx-auto mb-8">
      <motion.div
        animate={{ y: [0, -6, 0] }}
        transition={{ repeat: Infinity, duration: 3 }}
        className="absolute inset-0"
      >
        <svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" className="w-full h-full drop-shadow-[0_20px_40px_rgba(168,85,247,0.3)]">
          {/* Envelope body */}
          <rect x="30" y="60" width="140" height="100" rx="8" fill="#7C3AED" />
          {/* Flap (open) */}
          <path d="M30 60 L100 110 L170 60 L170 68 L100 118 L30 68 Z" fill="#6B21A8" />
          <path d="M30 60 L100 110 L170 60" fill="#A855F7" stroke="#6B21A8" strokeWidth="1" />
          {/* Front white sheet */}
          <rect x="50" y="80" width="100" height="60" rx="4" fill="white" />
          {/* @ symbol inside */}
          <text x="100" y="122" textAnchor="middle" fontSize="40" fontWeight="bold" fill="#7C3AED" fontFamily="serif">@</text>
        </svg>
      </motion.div>
    </div>
  );
}

export default function VerifyPage() {
  const router = useRouter();
  const { setTokens, refreshProfile } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(60);
  const [flow, setFlow] = useState<'signup' | 'signin'>('signup');
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const e = sessionStorage.getItem('pending_email');
    const f = sessionStorage.getItem('auth_flow') as 'signup' | 'signin' | null;
    if (!e) return router.replace('/auth/signup');
    setEmail(e);
    setFlow(f ?? 'signup');
    inputs.current[0]?.focus();
  }, [router]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const handleChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...code];
    next[i] = digit;
    setCode(next);
    if (digit && i < 5) inputs.current[i + 1]?.focus();
    if (digit && i === 5) submit(next.join(''));
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setCode(pasted.split(''));
      submit(pasted);
    }
  };

  const submit = async (fullCode: string) => {
    if (fullCode.length !== 6) return;
    setLoading(true);
    try {
      const data = unwrap<{ accessToken: string; refreshToken: string; isNewUser: boolean }>(
        await api.post('/auth/verify-otp', { email, code: fullCode })
      );
      setTokens(data.accessToken, data.refreshToken);
      await refreshProfile();
      sessionStorage.removeItem('pending_email');
      sessionStorage.removeItem('auth_flow');
      toast.success('Welcome to OmliveStream!');

      if (data.isNewUser) router.push('/onboarding');
      else window.location.assign(dashboardUrl());
    } catch (err) {
      toast.error(getApiError(err, 'Invalid or expired code'));
      setCode(['', '', '', '', '', '']);
      inputs.current[0]?.focus();
    } finally { setLoading(false); }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    try {
      await api.post('/auth/send-otp', { email });
      toast.success('New code sent');
      setResendIn(60);
    } catch (err) {
      toast.error(getApiError(err, 'Could not resend'));
    }
  };

  const isSignup = flow === 'signup';

  return (
    <AuthLayout>
      <EnvelopeIllustration />

      <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight text-center mb-3">
        {isSignup ? "We've sent an email" : 'Verify your email to continue'}
      </h1>
      <p className="text-center text-muted text-sm mb-8">
        We've sent a 6-digit {isSignup ? 'signup' : 'login'} code to<br />
        <span className="text-text">{email}</span>
      </p>

      <div className="flex gap-2 justify-center mb-8">
        {code.map((digit, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el; }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            className="w-12 h-14 text-center text-2xl font-display font-semibold rounded-xl bg-elevated/60 border border-border focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        ))}
      </div>

      <button
        onClick={() => submit(code.join(''))}
        disabled={loading || code.some(c => !c)}
        className="w-full py-4 rounded-2xl bg-primary text-white font-semibold text-lg hover:bg-primary/90 transition shadow-lg shadow-primary/25 disabled:opacity-60"
      >
        {loading ? 'Verifying…' : (isSignup ? 'Sign Up' : 'Sign In')}
      </button>

      <p className="mt-6 text-center text-sm text-muted">
        Didn't receive a code yet?{' '}
        <button onClick={resend} disabled={resendIn > 0} className="text-primary hover:underline disabled:opacity-50 disabled:cursor-not-allowed">
          {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend'}
        </button>
      </p>
    </AuthLayout>
  );
}
