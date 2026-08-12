'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Navbar } from '@/components/landing/Navbar';
import { WavyBackground } from '@/components/ui/WavyBackground';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="relative flex-1 overflow-hidden">
        <WavyBackground />
        <div className="relative z-10 flex items-center justify-center min-h-[calc(100vh-80px)] px-6 py-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center w-full max-w-2xl"
          >
            {/* 404 as "signal lost" — the one metaphor a streaming product
                already owns. Drawn rather than loaded: this replaces a
                hot-linked PNG, so the error page no longer depends on a
                third-party image host being reachable, which is exactly the
                wrong thing to depend on while something is already broken. */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="relative w-full max-w-md sm:max-w-lg mx-auto mb-8 md:mb-10"
            >
              <svg viewBox="0 0 480 260" className="w-full h-auto" role="img"
                   aria-label="Signal lost — page not found">
                <defs>
                  <linearGradient id="nf-num" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor="#A855F7" />
                    <stop offset="100%" stopColor="#EC4899" />
                  </linearGradient>
                  <radialGradient id="nf-glow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%"   stopColor="#7C3AED" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
                  </radialGradient>
                </defs>

                <ellipse cx="240" cy="130" rx="210" ry="110" fill="url(#nf-glow)" />

                {/* Flat line through the middle: the dropped signal */}
                <motion.path
                  d="M20 130 H150 l14 -34 l16 68 l14 -34 H300 l14 -22 l16 44 l14 -22 H460"
                  fill="none" stroke="rgba(168,85,247,0.35)" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 1.4, ease: 'easeInOut' }}
                />

                <text
                  x="240" y="130"
                  textAnchor="middle" dominantBaseline="central"
                  fill="url(#nf-num)"
                  style={{
                    fontFamily: 'var(--font-fraunces), serif',
                    fontSize: 128, fontWeight: 700, letterSpacing: '-0.03em',
                  }}
                >
                  404
                </text>

                {/* Offline chip, mirroring the LIVE chip elsewhere.
                    Colours go through `style`, not through fill/stroke
                    attributes: SVG presentation attributes do not reliably
                    resolve var(), so the attribute form would keep the dark
                    theme's navy chip on the light page. */}
                <g>
                  <rect x="196" y="196" width="88" height="26" rx="13"
                        style={{
                          fill: 'rgb(var(--c-elevated))',
                          stroke: 'rgb(var(--c-primary) / 0.35)',
                        }} />
                  <motion.circle
                    cx="214" cy="209" r="4"
                    style={{ fill: 'rgb(var(--c-danger))' }}
                    animate={{ opacity: [1, 0.25, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                  <text x="228" y="209" dominantBaseline="central"
                        style={{
                          fill: 'rgb(var(--c-muted))',
                          fontFamily: 'var(--font-jetbrains), monospace',
                          fontSize: 11, letterSpacing: '0.08em',
                        }}>
                    OFFLINE
                  </text>
                </g>
              </svg>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="font-display text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight leading-tight mb-6 md:mb-8 px-4"
            >
              We couldn't find the page<br className="hidden sm:inline" />
              <span className="sm:hidden"> </span>you were looking for
            </motion.h1>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-7 py-3.5 rounded-2xl bg-primary text-white font-semibold text-base hover:bg-primary/90 transition shadow-lg shadow-primary/25"
              >
                Back to Homepage
              </Link>
            </motion.div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
