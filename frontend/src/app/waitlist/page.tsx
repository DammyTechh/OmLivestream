'use client';
import { useState } from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Mail, Sparkles, Gift, Percent, Zap, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import { Navbar } from '@/components/landing/Navbar';
import { Footer } from '@/components/landing/Footer';
import { WavyBackground } from '@/components/ui/WavyBackground';
import { api, getApiError } from '@/lib/api';
import { WAITLIST_DISCOUNT_PCT, WAITLIST_DISCOUNT_MONTHS } from '@/lib/pricing';

const BENEFITS = [
  { Icon: Gift,    title: '1 Month FREE',            desc: 'Full Premium access, completely free for your first month' },
  { Icon: Percent, title: `${WAITLIST_DISCOUNT_PCT}% Off First ${WAITLIST_DISCOUNT_MONTHS} Months`, desc: `${WAITLIST_DISCOUNT_PCT}% off every month for your first ${WAITLIST_DISCOUNT_MONTHS} months of Premium` },
  { Icon: Zap,     title: 'Extended Trial (120 days)', desc: 'Waitlist members get 30 extra trial days on signup' },
];

export default function WaitlistPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return toast.error('Enter your email');
    setLoading(true);
    try {
      await api.post('/waitlist/join', { email, source: 'waitlist_page' });
      toast.success("You're on the list!");
      setSubmitted(true);
    } catch (err) {
      toast.error(getApiError(err, 'Could not join waitlist'));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="relative flex-1 overflow-hidden">
        <WavyBackground />
        <div className="relative z-10 mx-auto max-w-4xl px-6 py-16 lg:py-24">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-12"
          >
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-xs text-primary mb-6">
              <Sparkles size={12} /> Early Access Program
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]">
              Join the <span className="italic text-primary">waitlist.</span>
            </h1>
            <p className="mt-6 text-lg text-muted max-w-xl mx-auto">
              Be the first to stream across every major platform — and unlock exclusive launch rewards for waitlist members only.
            </p>
          </motion.div>

          {/* Benefits grid */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid md:grid-cols-3 gap-4 mb-12"
          >
            {BENEFITS.map((b, i) => (
              <div key={i} className="rounded-2xl p-6 bg-[#14102A]/60 border border-primary/20">
                <div className="w-11 h-11 rounded-xl bg-primary/20 flex items-center justify-center mb-4">
                  <b.Icon size={20} className="text-primary" />
                </div>
                <h3 className="font-display text-lg font-semibold mb-2">{b.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{b.desc}</p>
              </div>
            ))}
          </motion.div>

          {/* Waitlist form */}
          {submitted ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="max-w-xl mx-auto text-center rounded-3xl p-10 bg-gradient-to-br from-primary/15 to-accent/10 border border-primary/30"
            >
              <div className="w-16 h-16 rounded-full bg-success/20 border border-success/40 flex items-center justify-center mx-auto mb-5">
                <Check size={32} className="text-success" />
              </div>
              <h2 className="font-display text-2xl font-semibold mb-3">You're in!</h2>
              <p className="text-muted mb-6">
                We've sent a confirmation to your email. When you sign up, your reward codes will be applied automatically — no manual entry needed.
              </p>
              <Link href="/auth/signup" className="inline-block px-6 py-3 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition">
                Create account now →
              </Link>
            </motion.div>
          ) : (
            <motion.form
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              onSubmit={submit}
              className="max-w-xl mx-auto rounded-3xl p-8 bg-[#14102A]/70 border border-primary/20"
            >
              <label className="text-sm font-medium text-muted mb-2 block">Your email</label>
              <div className="relative mb-4">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full pl-12 pr-5 py-4 rounded-2xl bg-[#1F1538]/60 border border-primary/20 text-text placeholder:text-muted focus:border-primary/60 focus:outline-none transition"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 rounded-2xl bg-primary text-white font-semibold text-lg hover:bg-primary/90 transition shadow-lg shadow-primary/25 disabled:opacity-60"
              >
                {loading ? 'Joining…' : 'Claim my early access'}
              </button>
              <p className="text-xs text-muted text-center mt-4">
                No spam. Rewards automatically applied when you sign up.
              </p>
            </motion.form>
          )}

          <p className="text-center text-sm text-muted mt-12">
            Over <span className="text-primary font-semibold">1,200+ creators</span> already on the list.
          </p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
