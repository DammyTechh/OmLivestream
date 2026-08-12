import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The wordmark is live text, not a baked image, on purpose.
 *
 * The old logo.webp had "Omlive" set in a pale lavender that was tuned for the
 * near-black dark theme; on the light theme (#F6F4FA page, white cards) that
 * half of the lockup dropped to ~3:1 and effectively disappeared, leaving only
 * "Stream" legible. A raster can't be recoloured per theme, so the orb — the
 * one part that genuinely needs the artwork — is kept as a transparent mark
 * (logo-mark.webp, cropped from the original) and the wordmark is rendered as
 * text with a gradient built from the theme tokens. Same hue family in both
 * modes, always legible: primary→accent is 6.5:1+ on white and bright on dark.
 */
export function Logo({
  className,
  size = 'md',
  href = '/',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  href?: string | null;
}) {
  // Orb height and matching wordmark type scale.
  const dims = {
    sm: { h: 24, text: 'text-lg' },
    md: { h: 30, text: 'text-2xl' },
    lg: { h: 40, text: 'text-3xl' },
  } as const;
  const { h, text } = dims[size];

  const lockup = (
    <span className="inline-flex items-center gap-2">
      <Image
        src="/logo-mark.webp"
        alt=""
        width={h * 2}
        height={h * 2}
        style={{ width: h, height: h }}
        className="drop-shadow-[0_0_18px_rgba(168,85,247,0.35)] shrink-0"
        priority
      />
      <span
        className={cn(
          'font-bold tracking-tight leading-none whitespace-nowrap',
          'bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent',
          text,
        )}
      >
        OmliveStream
      </span>
    </span>
  );

  if (!href) return <div className={cn('inline-flex items-center', className)}>{lockup}</div>;
  return (
    <Link href={href} className={cn('inline-flex items-center group', className)} aria-label="OmliveStream">
      {lockup}
    </Link>
  );
}
