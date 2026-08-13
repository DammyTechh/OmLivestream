import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The wordmark is live text, not a baked image, on purpose.
 *
 * The old logo.webp had "Omlive" set in a pale lavender tuned for the near-black
 * dark theme; on the light theme it dropped to ~3:1 and effectively disappeared,
 * leaving only "Stream" legible. A raster can't be recoloured per theme, so the
 * orb — the one part that genuinely needs artwork — is kept as a transparent
 * mark (logo-mark.webp, cropped from the original) and the wordmark is set as
 * text.
 *
 * Two solid colours rather than a gradient sweep: the text colour carries
 * "Omlive" and the single brand violet picks out "Stream". A three-stop
 * violet→pink gradient across a wordmark is the sort of thing that dates a
 * product instantly, and it also read as muddy at small sizes.
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
        className="shrink-0"
        priority
      />
      <span
        className={cn(
          'font-semibold tracking-tight leading-none whitespace-nowrap text-text',
          text,
        )}
      >
        Omlive<span className="text-primary">Stream</span>
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
