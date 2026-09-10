'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Radio, MessageSquare, Gauge, Video, Wand2, Scissors, SlidersHorizontal,
  Users, Clock, TrendingUp, Layers, Sparkles, ArrowRight, } from 'lucide-react';

const FEATURES = [
  { Icon: Radio,             title: 'Multi-Platform Streaming', desc: 'Broadcast to Facebook, TikTok, Instagram, Twitch, YouTube and more at once — from a single unified dashboard.' },
  { Icon: Gauge,             title: 'Network Condition Detection', desc: 'Automatically adjusts your streaming resolution to your internet quality for a smoother, more reliable broadcast.' },
  { Icon: MessageSquare,     title: 'Unified Comment Dashboard', desc: 'View and respond to comments from every connected platform in one centralized place.' },
  { Icon: TrendingUp,        title: 'Live Audience Analytics', desc: 'Track audience engagement and stream performance as it happens.' },
  { Icon: Video,             title: 'Automatic Live Recording', desc: 'Every live session is saved automatically, ready to reuse whenever you need it.' },
  { Icon: Wand2,             title: 'AI-Powered Video Editing', desc: 'Turn recorded live sessions into polished, shareable content in a few clicks.' },
  { Icon: Scissors,          title: 'Manual Editor Workspace', desc: 'Prefer full creative control? Fine-tune and export your videos before saving to your device.' },
  { Icon: SlidersHorizontal, title: 'Bandwidth Optimization', desc: 'Optimized latency and intelligent bandwidth management keep your stream performing at its best.' },
];

const PROBLEMS = [
  'Juggling multiple devices or browsers to stream across different platforms.',
  'Monitoring comments from different social channels separately.',
  'Poor streaming quality caused by unstable internet connections.',
  'Spending hours editing recorded live sessions after streaming.',
  'Missing larger audiences by being limited to one platform at a time.',
];

const AUDIENCE = [
  'Content Creators', 'Social Media Influencers', 'Entrepreneurs & Business Owners',
  'Digital Marketers', 'Religious Organizations & Churches', 'Educational Institutions & Tutors',
  'Entertainment Brands', 'Event Organizers', 'Podcasters', 'Gaming Streamers',
  'Media Companies', 'Corporate Webinars & Virtual Events',
];

const VALUE = [
  { Icon: Layers,     text: 'Reach more audiences by streaming everywhere at once.' },
  { Icon: Clock,      text: 'Save time by managing everything from one dashboard.' },
  { Icon: MessageSquare, text: 'Increase engagement with centralized comment management.' },
  { Icon: Gauge,      text: 'Improve stream quality with intelligent network optimization.' },
  { Icon: Wand2,      text: 'Repurpose live content faster with AI-assisted editing.' },
  { Icon: Radio,      text: 'Eliminate multiple devices and complicated streaming setups.' },
];

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
};

export function AboutContent() {
  return (
    <>
      {/* Intro */}
      <section className="relative overflow-hidden py-20 lg:py-28">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-transparent to-transparent" />
        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <motion.div
            {...reveal}
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary mb-5"
          >
            About OmliveStream
          </motion.div>
          <motion.h1
            {...reveal}
            transition={{ delay: 0.05 }}
            className="font-display text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05]"
          >
            Stream <span className="italic text-primary">everywhere</span>,<br className="hidden sm:block" /> from one place.
          </motion.h1>
          <motion.p
            {...reveal}
            transition={{ delay: 0.12 }}
            className="mt-6 text-[16px] md:text-lg text-muted leading-relaxed max-w-2xl mx-auto"
          >
            OmliveStream is a web-based live streaming platform that lets you broadcast to multiple
            social media platforms simultaneously from a single, unified dashboard. Instead of
            managing several devices or logging into each platform individually, you can go live on
            Facebook, TikTok, Instagram, Twitch, YouTube and more — all at once, from one device.
          </motion.p>
          <motion.div {...reveal} transition={{ delay: 0.18 }} className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/25"
            >
              Start streaming <ArrowRight size={18} />
            </Link>
            <Link
              href="/#features"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-veil/5 border border-veil/10 text-text font-medium hover:bg-veil/10 transition"
            >
              Explore Features
            </Link>
          </motion.div>
        </div>
      </section>

      {/* The problem */}
      <section className="relative py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div {...reveal}>
              <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
                The problem we solve.
              </h2>
              <p className="mt-5 text-[15px] text-muted leading-relaxed">
                Creators and organizations lose time and reach wrestling with fragmented tools.
                OmliveStream replaces that scattered workflow with one all-in-one streaming and
                content management solution.
              </p>
            </motion.div>
            <motion.div {...reveal} transition={{ delay: 0.1 }} className="space-y-3">
              {PROBLEMS.map((p, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-4 rounded-2xl bg-surface/60 border border-border"
                >
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-danger/15 border border-danger/40 text-danger text-xs flex items-center justify-center shrink-0">✕</span>
                  <span className="min-w-0 text-sm text-muted leading-relaxed">{p}</span>
                </div>
              ))}
            </motion.div>
          </div>
        </div>
      </section>

      {/* What we built */}
      <section className="relative py-20">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div {...reveal} className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
              Everything you need to go live.
            </h2>
            <p className="mt-5 text-[15px] text-muted leading-relaxed">
              Built to simplify live streaming while delivering high performance through optimized
              latency and intelligent bandwidth management.
            </p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map((f, i) => (
              <motion.div
                key={i}
                {...reveal}
                transition={{ delay: (i % 4) * 0.06 }}
                className="group rounded-2xl bg-surface/60 border border-border p-6 hover:border-primary/40 transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center mb-5 shadow-lg">
                  <f.Icon size={20} className="text-white" />
                </div>
                <h3 className="font-display text-base font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{f.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Value proposition */}
      <section className="relative py-20">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div {...reveal} className="text-center max-w-2xl mx-auto mb-14">
            <h2 className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
              Why creators choose OmliveStream.
            </h2>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {VALUE.map((v, i) => (
              <motion.div
                key={i}
                {...reveal}
                transition={{ delay: (i % 3) * 0.06 }}
                className="flex items-start gap-4 p-6 rounded-2xl bg-surface/60 border border-border"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                  <v.Icon size={18} className="text-primary" />
                </div>
                <p className="min-w-0 text-sm text-text/90 leading-relaxed">{v.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Audience */}
      <section className="relative py-20">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <motion.h2 {...reveal} className="font-display text-3xl md:text-4xl font-semibold tracking-tight">
            Built for anyone who goes live.
          </motion.h2>
          <motion.p {...reveal} transition={{ delay: 0.08 }} className="mt-5 text-[15px] text-muted max-w-2xl mx-auto">
            If your audience is watching, OmliveStream helps you reach them — wherever they are.
          </motion.p>
          <motion.div {...reveal} transition={{ delay: 0.14 }} className="mt-10 flex flex-wrap justify-center gap-3">
            {AUDIENCE.map((a, i) => (
              <span
                key={i}
                className="px-4 py-2 rounded-full bg-elevated/60 border border-border text-sm text-muted hover:border-primary/40 hover:text-text transition"
              >
                {a}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

        {/* Sign-up call to action.
        
            The roadmap panel that used to sit here has been removed. Listing
            unreleased features on a live product invites the question of when
            they arrive, and the answer is not one we can commit to yet — so it
            was raising expectations rather than earning sign-ups. The single
            action remains, now centred and given the whole width. */}
        <section className="relative py-20">
          <div className="mx-auto max-w-3xl px-6">
            <motion.div
              {...reveal}
              className="rounded-3xl bg-gradient-to-br from-primary/10 via-primary-deep/[0.06] to-accent/10 border border-primary/25 p-8 md:p-12 text-center"
            >
              <Users size={24} className="text-primary mx-auto mb-5" />
              <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight mb-4">
                Start streaming today
              </h2>
              <p className="text-muted leading-relaxed mb-8 max-w-xl mx-auto">
                OmliveStream is live. Create an account, connect your platforms, and broadcast
                to all of them at once — <span className="text-text font-medium">free to
                start</span>, with no card required.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/25"
                >
                  Create your account <ArrowRight size={18} />
                </Link>
                <Link
                  href="/auth/signin"
                  className="inline-flex items-center justify-center px-7 py-3.5 rounded-2xl border border-border text-text font-semibold hover:bg-veil/5 transition"
                >
                  Sign in
                </Link>
              </div>
            </motion.div>
          </div>
        </section>
    </>
  );
}
