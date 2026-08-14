'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Mail, LayoutDashboard, Radio } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { WavyBackground } from '@/components/ui/WavyBackground';
import { SocialButtons } from '@/components/auth/SocialButtons';
import { StreamGraphic } from '@/components/ui/StreamGraphic';
import { YouTubeIcon, FacebookIcon, InstagramIcon, TikTokIcon, TwitchIcon, XIcon, LinkedInIcon, KickIcon } from '@/components/ui/BrandIcons';
import { TOKEN_KEYS } from '@/lib/api';
import { tokenStore } from '@/lib/token-store';

const PLATFORMS = [
  { name: 'YouTube',   Icon: YouTubeIcon   },
  { name: 'Facebook',  Icon: FacebookIcon  },
  { name: 'Instagram', Icon: InstagramIcon },
  { name: 'TikTok',    Icon: TikTokIcon    },
  { name: 'Twitch',    Icon: TwitchIcon    },
  { name: 'X',         Icon: XIcon         },
  { name: 'LinkedIn',  Icon: LinkedInIcon  },
  { name: 'Kick',      Icon: KickIcon      },
];

export function Hero() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null);
  const [userName, setUserName] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? tokenStore.get(TOKEN_KEYS.ACCESS) : null;
    setIsAuthed(!!token);
    if (token) {
      try {
        const userStr = localStorage.getItem(TOKEN_KEYS.USER);
        if (userStr) {
          const u = JSON.parse(userStr);
          setUserName(u.full_name?.split(' ')[0] ?? null);
        }
      } catch { /* ignore */ }
    }
  }, []);

  const startStreaming = (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim()) sessionStorage.setItem('prefill_email', email);
    router.push('/auth/signup');
  };

  return (
    <section className="relative overflow-hidden">
      <WavyBackground />
      <div className="relative z-10 mx-auto max-w-7xl px-6 pt-16 lg:pt-24 pb-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="relative order-2 lg:order-1"
          >
            <div className="relative max-w-lg mx-auto">
              <StreamGraphic />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="order-1 lg:order-2"
          >
            <h1 className="font-display text-[clamp(2.5rem,5vw,3.75rem)] font-semibold leading-[1.05] tracking-tight">
              Stream Smarter. Reach<br />
              Faster. Broadcast<br />
              Anywhere.
            </h1>
            <p className="mt-5 text-[15px] text-muted leading-relaxed max-w-md">
              From viral social clips to 24/7 live events, our powerful multi-streamer
              lets you connect with your audience seamlessly across every platform.
            </p>

            {/* Show different CTA based on auth state */}
            {isAuthed === null ? (
              // loading state — empty space to prevent layout shift
              <div className="mt-8 h-40 max-w-md" />
            ) : isAuthed ? (
              // Logged in user — show dashboard + go live CTAs
              <div className="mt-8 space-y-3 max-w-md">
                <p className="text-text/90 text-base">
                  Welcome back{userName ? `, ${userName}` : ''}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <Link
                    href="/dashboard"
                    className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/25"
                  >
                    <LayoutDashboard size={18} /> Dashboard
                  </Link>
                  <Link
                    href="/dashboard/streams/new"
                    className="flex items-center justify-center gap-2 py-4 rounded-2xl bg-veil/5 border border-primary/30 text-text font-semibold hover:bg-veil/10 transition"
                  >
                    <Radio size={18} /> Go Live
                  </Link>
                </div>
              </div>
            ) : (
              // Logged out — show email signup form
              <>
                <form onSubmit={startStreaming} className="mt-8 space-y-3 max-w-md">
                  <div className="relative">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      className="w-full px-5 py-4 pr-12 rounded-2xl bg-elevated/60 border border-border text-text placeholder:text-muted focus:border-primary/60 focus:outline-none transition"
                    />
                    <Mail className="absolute right-4 top-1/2 -translate-y-1/2 text-muted" size={18} />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-4 rounded-2xl bg-primary text-white font-semibold text-lg hover:bg-primary/90 transition shadow-lg shadow-primary/25 flex items-center justify-center gap-2"
                  >
                    Start Streaming
                  </button>
                  <p className="text-xs text-center text-muted">
                    Not ready to stream yet?{' '}
                    <Link href="/waitlist" className="text-primary hover:underline font-medium">
                      Join the waitlist
                    </Link>
                  </p>
                </form>

                <div className="mt-6 max-w-md">
                  <SocialButtons label="or continue with" />
                </div>
              </>
            )}
          </motion.div>
        </div>

        {/* Supported platforms strip */}
        <div className="mt-24 lg:mt-28">
          <p className="text-center text-[15px] text-muted mb-8">Supported Platforms</p>
          <div className="flex items-center justify-center gap-5 md:gap-8 flex-wrap">
            {PLATFORMS.map((p) => (
              <motion.div
                key={p.name}
                whileHover={{ y: -4, scale: 1.05 }}
                className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center hover:border-primary/50 transition"
              >
                <p.Icon size={28} />
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
