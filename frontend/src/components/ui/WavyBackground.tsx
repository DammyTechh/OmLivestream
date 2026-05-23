'use client';
import { motion } from 'framer-motion';

/**
 * Matches the Figma design — wavy concentric curves bottom-left
 * with radial glow bleeding across the page.
 */
export function WavyBackground({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {/* Radial purple glow */}
      <div
        className="absolute left-1/4 top-1/3 w-[80vw] h-[80vw] rounded-full opacity-[0.18] blur-[100px]"
        style={{ background: 'radial-gradient(circle at center, #A855F7 0%, #7C3AED 30%, transparent 70%)' }}
      />
      <div
        className="absolute -left-32 -bottom-32 w-[60vw] h-[60vw] rounded-full opacity-[0.15] blur-[120px]"
        style={{ background: 'radial-gradient(circle at center, #EC4899 0%, transparent 70%)' }}
      />

      {/* Wavy concentric lines — anchored bottom-left */}
      <svg className="absolute left-0 bottom-0 w-full h-full" viewBox="0 0 1440 900" preserveAspectRatio="xMinYMax slice" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="waveGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#A855F7" stopOpacity="0.35" />
            <stop offset="50%"  stopColor="#7C3AED" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#A855F7" stopOpacity="0.05" />
          </linearGradient>
        </defs>
        {/* Draw 40 concentric wavy lines */}
        {Array.from({ length: 45 }).map((_, i) => {
          const offset = i * 22;
          return (
            <path
              key={i}
              d={`M ${-200 - offset} ${900 + offset / 2}
                  Q ${300 - offset / 3} ${600 - offset * 0.7}, ${700 - offset / 4} ${700 - offset * 0.5}
                  T ${1500} ${400 - offset * 0.6}`}
              fill="none"
              stroke="url(#waveGrad)"
              strokeWidth="1"
              opacity={Math.max(0.05, 0.7 - i * 0.015)}
            />
          );
        })}
      </svg>

      {/* Noise overlay for texture */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
