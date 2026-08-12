'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Logo } from '@/components/ui/Logo';
import { StreamGraphic } from '@/components/ui/StreamGraphic';
import { WavyBackground } from '@/components/ui/WavyBackground';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Mobile top nav (visible only on small screens) */}
      <div className="lg:hidden flex items-center justify-between p-5 border-b border-border relative z-20">
        <Logo size="sm" />
        <div className="flex items-center gap-1">
          <Link href="/" className="text-sm text-muted hover:text-text transition px-2">← Home</Link>
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex">
        {/* LEFT: illustration — hidden on mobile, visible lg+.

            This panel keeps its fixed violet gradient in both themes. It is
            artwork rather than chrome, and it is what gives the sign-in page
            its identity; bleaching it for light mode would leave a blank
            column. So the white text and white-alpha values inside it stay
            white — they sit on that gradient, not on the page. */}
        <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-gradient-to-br from-[#1A0E3A] via-[#2D0F5F] to-[#7C3AED]">
          <WavyBackground />
          <div className="relative z-10 flex flex-col justify-between p-12 w-full">
            <Logo size="md" />

            <div className="flex-1 flex items-center justify-center py-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.8 }}
                className="relative w-full max-w-md"
              >
                <StreamGraphic />
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <h2 className="font-display text-2xl lg:text-3xl font-semibold tracking-tight text-white mb-3 leading-tight">
                Stream Smarter. Reach<br />
                Faster. <span className="italic opacity-80">Broadcast Anywhere.</span>
              </h2>
              <p className="text-white/70 text-sm max-w-sm leading-relaxed">
                From viral social clips to 24/7 live events, our powerful multi-streamer lets you connect with your audience seamlessly across every platform.
              </p>
            </motion.div>
          </div>
        </div>

        {/* RIGHT: form area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* On lg+ the mobile top nav is hidden, so the theme control needs its
              own quiet perch above the form. */}
          <div className="hidden lg:flex items-center justify-end gap-2 px-8 pt-6 relative z-20">
            <Link href="/" className="text-sm text-muted hover:text-text transition px-2">← Home</Link>
            <ThemeToggle />
          </div>

          <div className="flex-1 relative overflow-hidden">
            <WavyBackground className="lg:hidden" />
            <div className="relative z-10 w-full max-w-md mx-auto px-6 py-10 lg:py-16">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
              >
                {children}
              </motion.div>
            </div>
          </div>

          {/* Footer */}
          <footer className="border-t border-border py-5 px-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted max-w-md mx-auto">
              <p>© {new Date().getFullYear()} OmliveStream</p>
              <div className="flex gap-5">
                <Link href="/privacy"  className="hover:text-text transition">Privacy</Link>
                <Link href="/terms"    className="hover:text-text transition">Terms</Link>
                <Link href="/#contact" className="hover:text-text transition">Contact</Link>
              </div>
            </div>
          </footer>
        </div>
      </div>
    </div>
  );
}
