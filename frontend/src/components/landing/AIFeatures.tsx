'use client';
import { motion } from 'framer-motion';
import { Wand2, Sparkles, Scissors, PenTool, Hash, FileVideo } from 'lucide-react';

const AI_CAPABILITIES = [
  {
    Icon: Wand2,
    title: 'AI Title Generator',
    desc: 'Describe your stream, get 5 click-worthy titles optimized per platform.',
    accent: 'from-purple-500 to-pink-500',
  },
  {
    Icon: Scissors,
    title: 'Smart Video Editing',
    desc: 'Trim dead space, add captions, remove backgrounds — all from a text prompt.',
    accent: 'from-blue-500 to-purple-500',
  },
  {
    Icon: PenTool,
    title: 'Stream Descriptions',
    desc: 'Auto-generate SEO-friendly descriptions that drive discovery.',
    accent: 'from-pink-500 to-orange-500',
  },
  {
    Icon: Hash,
    title: 'Hashtag Suggestions',
    desc: 'Trending, niche-specific hashtags for every platform instantly.',
    accent: 'from-green-500 to-teal-500',
  },
  {
    Icon: FileVideo,
    title: 'Clip Highlights',
    desc: 'AI finds your best moments and exports them as short-form clips.',
    accent: 'from-amber-500 to-red-500',
  },
  {
    Icon: Sparkles,
    title: 'Creative Assistant',
    desc: 'Chat for ideas, scripts, thumbnails — your 24/7 creative partner.',
    accent: 'from-indigo-500 to-purple-500',
  },
];

export function AIFeatures() {
  return (
    <section className="relative py-28 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.03] to-transparent" />
      <div className="relative mx-auto max-w-6xl px-6">
        <div className="text-center mb-16 max-w-2xl mx-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/15 border border-primary/30 text-xs text-primary mb-6"
          >
            <Sparkles size={12} /> Powered by AI
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="font-display text-4xl md:text-5xl font-semibold tracking-tight"
          >
            Your <span className="italic text-primary">creative partner</span>, built in.
          </motion.h2>
          <p className="mt-5 text-[15px] text-muted">
            Let AI handle the grunt work — titles, descriptions, clips, hashtags — so you can focus on going live.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {AI_CAPABILITIES.map((c, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              whileHover={{ y: -4 }}
              className="group relative rounded-2xl bg-[#14102A]/60 border border-primary/15 p-6 hover:border-primary/40 transition-all overflow-hidden"
            >
              <div className={`absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br ${c.accent} opacity-10 blur-2xl group-hover:opacity-20 transition`} />
              <div className={`relative w-11 h-11 rounded-xl bg-gradient-to-br ${c.accent} flex items-center justify-center mb-5 shadow-lg`}>
                <c.Icon size={20} className="text-white" />
              </div>
              <h3 className="relative font-display text-lg font-semibold mb-2">{c.title}</h3>
              <p className="relative text-sm text-muted leading-relaxed">{c.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Live AI preview teaser */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 rounded-3xl bg-gradient-to-br from-primary/10 via-purple-900/5 to-accent/10 border border-primary/25 p-8 md:p-10"
        >
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs text-muted mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Live demo
              </div>
              <h3 className="font-display text-2xl md:text-3xl font-semibold tracking-tight mb-3">
                "Make me 5 viral titles for my Valorant stream"
              </h3>
              <p className="text-muted leading-relaxed">
                Our AI Studio is available to every streamer from day one. Generate, refine, and publish — all without leaving OmliveStream.
              </p>
            </div>
            <div className="space-y-2">
              {[
                'Ranked Grind to Immortal — Drop Any Tips? 🔥',
                "Clutch or Kick — It's Friday Night Valorant",
                'First to Radiant Challenge — Day 3 (feat. Viewers)',
                'New Agent Tier List After 100 Games',
                'Ranked Only — No Hiding, No Excuses',
              ].map((t, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                  className="flex items-center gap-3 p-3 rounded-xl bg-[#1F1538]/60 border border-primary/15 text-sm"
                >
                  <Sparkles size={14} className="text-primary shrink-0" />
                  <span className="truncate">{t}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
