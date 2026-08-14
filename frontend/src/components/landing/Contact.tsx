'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { TOKEN_KEYS } from '@/lib/api';
import { api, getApiError } from '@/lib/api';
import toast from 'react-hot-toast';
import { FacebookIcon, InstagramIcon, TikTokIcon } from '@/components/ui/BrandIcons';

export function Contact() {
  const [form, setForm] = useState({ name: '', email: '', message: '' });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.email.trim() || !form.message.trim())
      return toast.error('All fields are required');
    if (form.message.length < 10)
      return toast.error('Message must be at least 10 characters');
    setLoading(true);
    try {
      await api.post('/contact', form);
      toast.success("Thanks — we'll get back to you soon.");
      setForm({ name: '', email: '', message: '' });
    } catch (err) {
      toast.error(getApiError(err, 'Could not send message'));
    } finally { setLoading(false); }
  };

  return (
    <section id="contact" className="relative py-24">
      <div className="mx-auto max-w-5xl px-6">
        {/* CTA block */}
        <div className="text-center mb-16 max-w-xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-display text-4xl md:text-5xl font-semibold tracking-tight"
          >
            What are you waiting for
          </motion.h2>
          <p className="mt-5 text-[15px] text-muted">
            One stream, infinite reach. Expand your community by broadcasting to YouTube, Facebook, TikTok, Instagram, and Twitch simultaneously.
          </p>

          <CtaButton />
        </div>

        {/* Contact Us card */}
        <div className="grid md:grid-cols-2 gap-10 rounded-[28px] bg-surface/60 border border-border p-8 md:p-12">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary mb-5">
              <Mail size={11} /> Send us a message
            </div>
            <h3 className="font-display text-3xl md:text-4xl font-semibold tracking-tight mb-4">Contact Us</h3>
            <p className="text-muted leading-relaxed mb-8 text-[15px]">
              Have questions or feedback? We're here to help. Drop us a message or reach out on social.
            </p>
            <div>
              <p className="text-xs text-muted mb-3">Or visit us on our social media handles:</p>
              <div className="flex flex-col gap-2.5">
                <a href="#" className="inline-flex items-center gap-2.5 text-muted hover:text-text transition w-fit px-3 py-1.5 rounded-full bg-elevated/60 border border-border">
                  <FacebookIcon size={14} />
                  <span className="text-xs">omlivestream@facebook</span>
                </a>
                <a href="#" className="inline-flex items-center gap-2.5 text-muted hover:text-text transition w-fit px-3 py-1.5 rounded-full bg-elevated/60 border border-border">
                  <InstagramIcon size={14} />
                  <span className="text-xs">omlivestream@instagram</span>
                </a>
                <a href="#" className="inline-flex items-center gap-2.5 text-muted hover:text-text transition w-fit px-3 py-1.5 rounded-full bg-elevated/60 border border-border">
                  <TikTokIcon size={14} />
                  <span className="text-xs">omlivestream@tiktok</span>
                </a>
              </div>
            </div>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-xs text-muted mb-1.5 block">Your Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Your fullname"
                className="w-full px-4 py-3 rounded-xl bg-elevated/60 border border-border text-text placeholder:text-muted/60 focus:border-primary/50 focus:outline-none transition"
              />
            </div>
            <div>
              <label className="text-xs text-muted mb-1.5 block">Your e-mail address</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="Enter email"
                className="w-full px-4 py-3 rounded-xl bg-elevated/60 border border-border text-text placeholder:text-muted/60 focus:border-primary/50 focus:outline-none transition"
              />
            </div>
            <div>
              <textarea
                value={form.message}
                onChange={(e) => setForm({ ...form, message: e.target.value })}
                placeholder="write us a message"
                rows={5}
                className="w-full px-4 py-3 rounded-xl bg-elevated/60 border border-border text-text placeholder:text-muted/60 focus:border-primary/50 focus:outline-none transition resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="ml-auto flex items-center gap-2 px-8 py-3 rounded-xl bg-primary text-white font-semibold hover:bg-primary/90 transition disabled:opacity-60"
            >
              {loading ? 'Sending…' : 'Submit'}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

function CtaButton() {
  const [authed, setAuthed] = useState<boolean>(false);
  useEffect(() => {
    setAuthed(!!(typeof window !== 'undefined' && localStorage.getItem(TOKEN_KEYS.ACCESS)));
  }, []);
  return (
    <Link
      href={authed ? '/dashboard' : '/auth/signup'}
      className="mt-8 inline-flex items-center gap-2 px-8 py-4 rounded-2xl bg-primary text-white font-semibold text-lg hover:bg-primary/90 transition shadow-lg shadow-primary/25"
    >
      {authed ? 'Go to Dashboard' : 'Start Streaming'}
    </Link>
  );
}
