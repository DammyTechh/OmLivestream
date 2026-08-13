'use client';

import { motion } from 'framer-motion';
import {
  YouTubeIcon, FacebookIcon, InstagramIcon,
  TikTokIcon, TwitchIcon, XIcon,
} from '@/components/ui/BrandIcons';

/**
 * The product, drawn.
 * ─────────────────────────────────────────────────────────────────
 * One capture source in the middle, six platforms around it, live signal
 * travelling outward along the wires. That is literally what the backend
 * does — a single ffmpeg reading one encode and fanning it out to every
 * connected platform at once — so the hero says it without a caption.
 *
 * This replaces a PNG that was hot-linked from imgur. Being real elements
 * rather than a flat bitmap, it stays sharp at any size, needs no image
 * request, recolours itself from the palette, and the platform marks are
 * the same authentic SVGs used everywhere else in the app.
 */

// Six seats on the circle. Angles start at the top and go clockwise, which
// puts the two largest platforms (YouTube, TikTok) on the horizontal axis
// where the eye lands first.
const ORBIT = [
  { Icon: YouTubeIcon,   angle: -90, label: 'YouTube'   },
  { Icon: TikTokIcon,    angle: -30, label: 'TikTok'    },
  { Icon: InstagramIcon, angle:  30, label: 'Instagram' },
  { Icon: FacebookIcon,  angle:  90, label: 'Facebook'  },
  { Icon: TwitchIcon,    angle: 150, label: 'Twitch'    },
  { Icon: XIcon,         angle: 210, label: 'X'         },
];

const R = 132;      // orbit radius within the 360x360 viewBox
const C = 180;      // centre

function seat(angle: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: C + R * Math.cos(rad), y: C + R * Math.sin(rad) };
}

export function StreamGraphic({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="relative w-full aspect-square">
        {/* Wires + glow live in SVG; the platform marks are real DOM nodes on
            top, so each one keeps its own gradients and official colours. */}
        <svg
          viewBox="0 0 360 360"
          className="absolute inset-0 w-full h-full"
          aria-hidden="true"
        >
          <defs>
            <radialGradient id="hg-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%"   stopColor="#A855F7" stopOpacity="0.55" />
              <stop offset="60%"  stopColor="#7C3AED" stopOpacity="0.12" />
              <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="hg-wire" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%"   stopColor="#A855F7" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#EC4899" stopOpacity="0.15" />
            </linearGradient>
          </defs>

          {/* Ambient bloom behind the core */}
          <circle cx={C} cy={C} r="150" fill="url(#hg-core)" />

          {/* Orbit rings */}
          <circle cx={C} cy={C} r={R} fill="none"
                  stroke="rgba(124,58,237,0.22)" strokeWidth="1" />
          <circle cx={C} cy={C} r={R - 46} fill="none"
                  stroke="rgba(124,58,237,0.12)" strokeWidth="1"
                  strokeDasharray="3 6" />

          {ORBIT.map(({ angle, label }) => {
            const { x, y } = seat(angle);
            return (
              <g key={label}>
                <line
                  x1={C} y1={C} x2={x} y2={y}
                  stroke="url(#hg-wire)" strokeWidth="1.5" strokeLinecap="round"
                />
                {/* A packet of signal running centre → platform. The stagger
                    keeps six dots from pulsing in unison, which would read
                    as decoration rather than as traffic. */}
                <motion.circle
                  r="3.5"
                  fill="#EC4899"
                  initial={{ opacity: 0 }}
                  animate={{
                    cx: [C, x], cy: [C, y],
                    opacity: [0, 1, 1, 0],
                  }}
                  transition={{
                    duration: 1.8,
                    repeat: Infinity,
                    delay: (angle + 90) / 120,
                    ease: 'easeOut',
                  }}
                />
              </g>
            );
          })}
        </svg>

        {/* Centre: the capture source, pulsing on the live indicator */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <motion.div
            animate={{ scale: [1, 1.04, 1] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
            className="relative w-[24%] min-w-[76px] aspect-square rounded-3xl
                       bg-gradient-to-br from-[#7C3AED] to-[#EC4899]
                       flex items-center justify-center
                       shadow-[0_0_60px_rgba(168,85,247,0.45)]"
            style={{ width: 86, height: 86 }}
          >
            {/* Play mark — echoes the glyph in the logo */}
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M8 5.5v13l11-6.5L8 5.5z" fill="white" />
            </svg>

            <span className="absolute -top-2 -right-2 flex items-center gap-1
                             px-2 py-0.5 rounded-full bg-danger text-white
                             text-[10px] font-semibold tracking-wide shadow-lg">
              <motion.span
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="w-1.5 h-1.5 rounded-full bg-white"
              />
              LIVE
            </span>
          </motion.div>
        </div>

        {/* Platform seats */}
        {ORBIT.map(({ Icon, angle, label }, i) => {
          const { x, y } = seat(angle);
          return (
            <motion.div
              key={label}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 * i, duration: 0.5 }}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${(x / 360) * 100}%`, top: `${(y / 360) * 100}%` }}
            >
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{
                  duration: 4, repeat: Infinity, ease: 'easeInOut',
                  delay: i * 0.4,
                }}
                className="w-14 h-14 rounded-2xl bg-[#14102A] text-white
                           border border-primary/25 flex items-center justify-center
                           shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                title={label}
              >
                <Icon size={26} />
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
