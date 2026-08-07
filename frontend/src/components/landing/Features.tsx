'use client';
import { motion } from 'framer-motion';
import { YouTubeIcon, FacebookIcon, InstagramIcon, TikTokIcon, TwitchIcon } from '@/components/ui/BrandIcons';

// ── Visual 1: Platform hub with central LIVE indicator ──
function PlatformsVisual() {
  const tiles = [
    { name: 'YouTube',   Icon: YouTubeIcon,   viewers: '1,885', pos: 'top-4 left-4'    },
    { name: 'TikTok',    Icon: TikTokIcon,    viewers: '3,242', pos: 'top-4 left-44'   },
    { name: 'Instagram', Icon: InstagramIcon, viewers: '753',   pos: 'top-4 right-4'   },
    { name: 'Facebook',  Icon: FacebookIcon,  viewers: '492',   pos: 'bottom-4 left-4' },
    { name: 'Twitch',    Icon: TwitchIcon,    viewers: '2,067', pos: 'bottom-4 left-44' },
  ];
  return (
    <div className="relative w-full h-80 rounded-3xl bg-[#14102A]/70 border border-primary/20 p-5 overflow-hidden">
      {tiles.map((t, i) => (
        <motion.div
          key={t.name}
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: i * 0.1 }}
          animate={{ y: [0, -4, 0] }}
          className={`absolute ${t.pos} bg-[#1F1538] border border-primary/20 rounded-xl px-3 py-2 flex items-center gap-2.5 shadow-lg`}
          style={{ animationDelay: `${i * 0.5}s` }}
        >
          <t.Icon size={18} />
          <div>
            <div className="text-[11px] font-medium text-text">{t.name}</div>
            <div className="text-[9px] text-muted">{t.viewers} viewers</div>
          </div>
        </motion.div>
      ))}
      {/* Central LIVE dot */}
      <motion.div
        animate={{ scale: [1, 1.1, 1] }}
        transition={{ repeat: Infinity, duration: 2 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center shadow-2xl shadow-primary/50"
      >
        <span className="font-display font-bold text-white text-sm tracking-wider">LIVE</span>
      </motion.div>
      {/* Connecting lines */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
        <line x1="20%" y1="15%" x2="50%" y2="50%" stroke="#A855F7" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="50%" y1="15%" x2="50%" y2="50%" stroke="#A855F7" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="80%" y1="15%" x2="50%" y2="50%" stroke="#A855F7" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="20%" y1="85%" x2="50%" y2="50%" stroke="#A855F7" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="50%" y1="85%" x2="50%" y2="50%" stroke="#A855F7" strokeWidth="1" strokeDasharray="3 3" />
      </svg>
    </div>
  );
}

// ── Visual 2: Live comments feed ──
function ChatVisual() {
  const msgs = [
    { user: '@alex_live',   text: 'Insane quality',           Icon: InstagramIcon, platform: 'Instagram' },
    { user: '@jayVOD',      text: 'Subbed and sharing',       Icon: FacebookIcon,  platform: 'Facebook'  },
    { user: '@nora_w',      text: 'What mic is that??',        Icon: YouTubeIcon,   platform: 'YouTube'   },
    { user: '@creator_kai', text: 'this is next level setup',  Icon: TikTokIcon,    platform: 'TikTok'    },
  ];
  return (
    <div className="w-full rounded-3xl bg-[#14102A]/70 border border-primary/20 p-5 overflow-hidden">
      <div className="text-[10px] uppercase tracking-widest text-muted mb-4 flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
        Live Comments — Reply per platform in real time
      </div>
      <div className="space-y-2.5">
        {msgs.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -20 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.12 }}
            className="flex items-start gap-3 p-2.5 rounded-xl bg-[#1F1538]/60"
          >
            <m.Icon size={16} />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-semibold">{m.user}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-muted">{m.platform}</span>
              </div>
              <div className="text-xs text-muted truncate">{m.text}</div>
              <button className="text-[10px] text-primary mt-1 hover:underline">↩ Reply</button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Visual 3: Stream quality / on-air dashboard ──
function QualityVisual() {
  return (
    <div className="relative w-full h-80 rounded-3xl bg-[#14102A]/70 border border-primary/20 p-6 overflow-hidden">
      <div className="text-center mb-4">
        <motion.div
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-danger/20 border border-danger/40"
        >
          <span className="w-2 h-2 rounded-full bg-danger animate-pulse" />
          <span className="text-danger text-xs font-bold">ON AIR</span>
        </motion.div>
        <p className="text-xs text-muted mt-2">Stream has been live for 1h 24m</p>
      </div>
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-widest text-muted">Network Status</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 border border-success/40 text-success">● GOOD</span>
        </div>
        <div className="font-display text-2xl font-semibold">6.4 Mbps upload</div>
        <div className="text-xs text-muted">Bitrate: 5939 kbps · 1080p30 · Latency: 38ms</div>
      </div>
      <div className="absolute bottom-6 left-6 right-6 h-16 flex items-end gap-[3px]">
        {Array.from({ length: 60 }).map((_, i) => (
          <motion.div
            key={i}
            animate={{ height: [`${20 + Math.random() * 60}%`, `${30 + Math.random() * 70}%`, `${20 + Math.random() * 60}%`] }}
            transition={{ repeat: Infinity, duration: 0.8 + Math.random(), ease: 'easeInOut' }}
            className="flex-1 rounded-full"
            style={{ background: 'linear-gradient(180deg, #10B981, #059669)' }}
          />
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    title: 'Stop choosing between your audiences.',
    body:  'Broadcast your live video to YouTube, Facebook, TikTok, Instagram, and Twitch all at once from a single browser tab. Expand your reach without increasing your workload.',
    visual: <PlatformsVisual />,
    flip: false,
  },
  {
    title: 'One Chat to Rule Them All.',
    body:  "Don't flip between apps to see who's talking. Manage all your cross-platform comments in one centralized feed, allowing you to engage with your entire community in real time.",
    visual: <ChatVisual />,
    flip: true,
  },
  {
    title: 'Professional Quality, Guaranteed.',
    body:  'OmliveStream automatically detects your upload speed and optimizes your bitrate and resolution. Experience a smooth, uninterrupted broadcast that adjusts to your connection so you never drop a frame.',
    visual: <QualityVisual />,
    flip: false,
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-28">
      <div className="mx-auto max-w-6xl px-6">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="font-display text-4xl md:text-5xl font-semibold tracking-tight mb-16"
        >
          Features
        </motion.h2>

        <div className="space-y-20">
          {FEATURES.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className={`grid lg:grid-cols-2 gap-12 items-center ${f.flip ? 'lg:[&>*:first-child]:order-2' : ''}`}
            >
              <div>{f.visual}</div>
              <div>
                <h3 className="font-display text-2xl md:text-3xl font-semibold leading-tight mb-4">{f.title}</h3>
                <p className="text-muted leading-relaxed text-[15px]">{f.body}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
