'use client';
import { motion } from 'framer-motion';
import { Wand2, Sparkles, Scissors, PenTool, Hash, FileVideo } from 'lucide-react';

const AI_CAPABILITIES = [
  {
    Icon: Wand2,
    title: 'AI Title Generator',
    desc: 'Describe your stream, get 5 click-worthy titles optimized per platform.',
  },
  {
    Icon: Scissors,
    title: 'Smart Video Editing',
    desc: 'Trim dead space, add captions, remove backgrounds — all from a text prompt.',
  },
  {
    Icon: PenTool,
    title: 'Stream Descriptions',
    desc: 'Auto-generate SEO-friendly descriptions that drive discovery.',
  },
  {
    Icon: Hash,
    title: 'Hashtag Suggestions',
    desc: 'Trending, niche-specific hashtags for every platform instantly.',
  },
  {
    Icon: FileVideo,
    title: 'Clip Highlights',
    desc: 'AI finds your best moments and exports them as short-form clips.',
  },
  {
    Icon: Sparkles,
    title: 'Creative Assistant',
    desc: 'Chat for ideas, scripts, thumbnails — your 24/7 creative partner.',
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
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary mb-5"
          >
            Powered by AI
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
              className="group relative rounded-2xl bg-surface/60 border border-border p-6 hover:border-primary/40 transition-all overflow-hidden"
            >
              {/* One brand tint for every capability. Six different two-colour
                  gradients turned a feature grid into a swatch book and implied
                  a colour-coding that never existed. */}
              <div className="relative w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                <c.Icon size={20} className="text-primary" strokeWidth={1.75} />
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
          className="mt-16 rounded-3xl bg-surface border border-border p-6 sm:p-8 md:p-10"
        >
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-veil/5 border border-veil/10 text-xs text-muted mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" /> Live demo
              </div>
              {/* text-balance keeps the quote from breaking to a one-word last
                  line, and the explicit quote marks are curly so they render
                  as typography rather than as inch marks. */}
              <h3 className="font-display text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-balance">
                &ldquo;Make me 5 viral titles for my Valorant stream&rdquo;
              </h3>
              <p className="text-muted leading-relaxed text-pretty">
                Our AI Studio is available to every streamer from day one. Generate, refine, and publish — all without leaving OmliveStream.
              </p>
            </div>
            <div className="space-y-2 min-w-0">
              {[
                'Ranked Grind to Immortal — Drop Any Tips?',
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
                  // items-start, not items-center: once a title wraps to two
                  // lines the icon should stay on the first line rather than
                  // float to the vertical middle of the block.
                  className="flex items-start gap-3 p-3 rounded-xl bg-elevated/60 border border-border text-sm"
                >
                  {/* A quiet dot rather than a sparkle on every row. Five
                      identical purple sparkles stacked down one column read as
                      decoration, not information — the icon said nothing the
                      list didn't already say, and repeating it was the loudest
                      thing on the panel. */}
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0 mt-[7px]" />
                  {/* These titles used to be `truncate`, which on a 390px
                      screen left a ~31-character budget against titles of up
                      to 50 — so every one was cut mid-word, including the
                      demo's most persuasive example. A generated-titles demo
                      that hides the generated titles argues against itself,
                      so they wrap instead. min-w-0 keeps the flex item from
                      refusing to shrink below its longest word. */}
                  <span className="min-w-0 flex-1 text-pretty">{t}</span>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
