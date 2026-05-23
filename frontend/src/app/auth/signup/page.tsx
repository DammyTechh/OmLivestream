'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Mail } from 'lucide-react';
import toast from 'react-hot-toast';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { SocialButtons } from '@/components/auth/SocialButtons';
import { api, getApiError } from '@/lib/api';

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // Prefill email from landing hero (if user tapped "Start Streaming" with an email)
  useEffect(() => {
    const prefill = sessionStorage.getItem('prefill_email');
    if (prefill) {
      setEmail(prefill);
      sessionStorage.removeItem('prefill_email');
    }
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error('Enter your email');
    setLoading(true);
    try {
      await api.post('/auth/send-otp', { email });
      sessionStorage.setItem('pending_email', email);
      sessionStorage.setItem('auth_flow', 'signup');
      toast.success('Code sent — check your email');
      router.push('/auth/verify');
    } catch (err) {
      toast.error(getApiError(err, 'Could not send code'));
    } finally { setLoading(false); }
  };

  return (
    <AuthLayout>
      <h1 className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-2 text-center">
        Create your account
      </h1>
      <p className="text-muted text-center mb-8 text-[15px]">
        Stream to every platform from one place.
      </p>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="relative">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email"
            className="w-full px-5 py-4 pr-12 rounded-2xl bg-[#1F1538]/60 border border-primary/20 text-text placeholder:text-muted focus:border-primary/60 focus:outline-none transition"
            required
          />
          <Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full py-4 rounded-2xl bg-primary text-white font-semibold text-lg hover:bg-primary/90 transition shadow-lg shadow-primary/25 disabled:opacity-60"
        >
          {loading ? 'Sending code…' : 'Start Streaming'}
        </button>
      </form>

      <div className="mt-6">
        <SocialButtons label="or continue with" />
      </div>

      <p className="text-center text-sm text-muted mt-8">
        Already have an account?{' '}
        <Link href="/auth/signin" className="text-primary hover:underline font-medium">Sign in</Link>
      </p>
    </AuthLayout>
  );
}
