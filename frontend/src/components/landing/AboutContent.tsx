'use client';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  Radio, MessageSquare, Gauge, Video, Wand2, Scissors, SlidersHorizontal,
  Users, Clock, TrendingUp, Layers, Sparkles, ArrowRight, Check,
} from 'lucide-react';

const FEATURES = [
  { Icon: Radio,             title: 'Multi-Platform Streaming', desc: 'Broadcast to Facebook, TikTok, Instagram, Twitch, YouTube and more at once — from a single unified dashboard.' },
  { Icon: Gauge,             title: 'Network Condition Detection', desc: 'Automatically adjusts your streaming resolution to your internet quality for a smoother, more reliable broadcast.' },
  { Icon: MessageSquare,     title: 'Unified Comment Dashboard', desc: 'View and respond to comments from every connected platform in one centralized place.' },
  { Icon: TrendingUp,        title: 'Live Analytics & Impressions', desc: 'Track audience engagement and stream performance as it happens.' },
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

const ROADMAP = [
  'Mobile Applications (iOS & Android)',
  'Desktop Software (Windows & macOS)',
  'Additional AI-powered creator tools',
  'More platform integrations and advanced analytics',
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
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-xs text-primary mb-6"
          >
            <Sparkles size={12} /> About OmliveStream
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
              href="/waitlist"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/25"
            >
              Join the Waitlist <ArrowRight size={18} />
            </Link>
            <Link
              href="/#features"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-text font-medium hover:bg-white/10 transition"
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
                  className="flex items-start gap-3 p-4 rounded-2xl bg-[#14102A]/60 border border-primary/15"
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
                className="group rounded-2xl bg-[#14102A]/60 border border-primary/15 p-6 hover:border-primary/40 transition-all"
              >
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-5 shadow-lg">
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
                className="flex items-start gap-4 p-6 rounded-2xl bg-[#14102A]/60 border border-primary/15"
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
                className="px-4 py-2 rounded-full bg-[#1F1538]/60 border border-primary/15 text-sm text-muted hover:border-primary/40 hover:text-text transition"
              >
                {a}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Roadmap + waitlist */}
      <section className="relative py-20">
        <div className="mx-auto max-w-6xl px-6">
          <motion.div
            {...reveal}
            className="rounded-3xl bg-gradient-to-br from-primary/10 via-purple-900/5 to-accent/10 border border-primary/25 p-8 md:p-12"
          >
            <div className="grid lg:grid-cols-2 gap-10 items-center">
              <div>
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-muted mb-5">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> On the roadmap
                </div>
                <h2 className="font-display text-2xl md:text-3xl font-semibold tracking-tight mb-4">
                  Available on the web today — with more on the way.
                </h2>
                <p className="text-muted leading-relaxed mb-6">
                  OmliveStream runs on a subscription model built for professional creators and
                  organizations. We're just getting started — here's what's coming next.
                </p>
                <ul className="space-y-3">
                  {ROADMAP.map((r, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-text/90">
                      <Check size={16} className="text-primary shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl bg-[#14102A]/70 border border-primary/20 p-7">
                <Users size={22} className="text-primary mb-4" />
                <h3 className="font-display text-xl font-semibold mb-2">Join the waitlist</h3>
                <p className="text-sm text-muted leading-relaxed mb-5">
                  Register now and get a <span className="text-text font-medium">1-month free premium
                  subscription</span> at launch, exclusive discounts on your first 3 months, and early
                  access to new features before the public release.
                </p>
                <Link
                  href="/waitlist"
                  className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary text-white font-semibold hover:bg-primary/90 transition shadow-lg shadow-primary/25"
                >
                  Reserve Your Spot <ArrowRight size={18} />
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>
    </>
  );
}
