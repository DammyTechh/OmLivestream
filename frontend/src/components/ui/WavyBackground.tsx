'use client';

/**
 * The ambient background: a violet glow bleeding across the page with wavy
 * concentric curves anchored bottom-left. Used on the hero, waitlist,
 * onboarding and 404.
 *
 * Every colour and opacity here comes from a CSS variable defined in
 * globals.css, because this artwork needs different values per theme rather
 * than the same ones recoloured:
 *
 *   - Opacity has to drop on light. A wash that reads as gentle light spill
 *     against near-black reads as muddy haze on white.
 *   - The hue has to deepen. #A855F7 at low opacity over white greys out;
 *     the deeper violet keeps the wash recognisably violet.
 *   - The grain has to change blend mode. `overlay` lifts texture on a dark
 *     surface but does almost nothing on white, where `multiply` is what
 *     actually shows the grain.
 *
 * Note the gradient stops are set through inline `style` rather than the
 * `stopColor` attribute: SVG presentation attributes do not reliably resolve
 * var(), but inline CSS does.
 */
export function WavyBackground({ className = '' }: { className?: string }) {
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {/* Primary glow */}
      <div
        className="absolute left-1/4 top-1/3 w-[80vw] h-[80vw] rounded-full blur-[100px]"
        style={{
          opacity: 'var(--glow-1-opacity)',
          background:
            'radial-gradient(circle at center, rgb(var(--c-glow-a)) 0%, rgb(var(--c-glow-b)) 30%, transparent 70%)',
        }}
      />
      {/* Secondary glow, warmer, anchored bottom-left */}
      <div
        className="absolute -left-32 -bottom-32 w-[60vw] h-[60vw] rounded-full blur-[120px]"
        style={{
          opacity: 'var(--glow-2-opacity)',
          background: 'radial-gradient(circle at center, rgb(var(--c-glow-c)) 0%, transparent 70%)',
        }}
      />

      {/* Wavy concentric lines */}
      <svg
        className="absolute left-0 bottom-0 w-full h-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMinYMax slice"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="waveGrad" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%"   style={{ stopColor: 'rgb(var(--c-glow-a))', stopOpacity: 'var(--wave-stop-1)' }} />
            <stop offset="50%"  style={{ stopColor: 'rgb(var(--c-glow-b))', stopOpacity: 'var(--wave-stop-2)' }} />
            <stop offset="100%" style={{ stopColor: 'rgb(var(--c-glow-a))', stopOpacity: 'var(--wave-stop-3)' }} />
          </linearGradient>
        </defs>
        <g style={{ opacity: 'var(--wave-opacity)' }}>
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
        </g>
      </svg>

      {/* Grain */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 'var(--grain-opacity)',
          mixBlendMode: 'var(--grain-blend)' as React.CSSProperties['mixBlendMode'],
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
    </div>
  );
}
