import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The lockup: an inline SVG mark plus live text. No image file, deliberately.
 *
 * Two separate problems led here.
 *
 * 1. The mark used to be /logo-mark.webp. A root-relative asset only resolves
 *    on a host that actually serves it, so on dashboard./payment./admin.
 *    omlivestream.com — which route to the app but do not necessarily serve its
 *    static files at the root — it rendered as a broken-image box. Drawing the
 *    mark inline removes the network request altogether, so it cannot 404, is
 *    immune to CDN and subdomain routing, stays sharp at any size, and costs no
 *    extra round trip.
 *
 * 2. The wordmark is `text-text`, which is near-black under the light theme.
 *    That is right on a light page and invisible on a dark one — and the
 *    sign-in illustration panel keeps its violet gradient in *both* themes, so
 *    under light mode "Omlive" disappeared into it while "Stream" (brand
 *    violet) survived. `tone="onDark"` pins the lockup to light ink for those
 *    fixed-dark surfaces instead of letting it follow the theme.
 */
export function Logo({
  className,
  size = 'md',
  href = '/',
  tone = 'auto',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  href?: string | null;
  /** 'onDark' for surfaces that stay dark in both themes (e.g. the auth panel). */
  tone?: 'auto' | 'onDark';
}) {
  const dims = {
    sm: { h: 26, text: 'text-lg'  },
    md: { h: 32, text: 'text-2xl' },
    lg: { h: 42, text: 'text-3xl' },
  } as const;
  const { h, text } = dims[size];

  const onDark = tone === 'onDark';

  const lockup = (
    <span className="inline-flex items-center gap-2">
      <svg
        width={h}
        height={h}
        viewBox="0 0 40 40"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <circle cx="20" cy="20" r="19" className="fill-primary" />
        {/* Play triangle, optically centred (a geometric centre reads left-heavy). */}
        <path d="M16.5 13.2 L28 20 L16.5 26.8 Z" fill="white" strokeLinejoin="round" strokeWidth="1.5" stroke="white" />
      </svg>
      <span
        className={cn(
          'font-semibold tracking-tight leading-none whitespace-nowrap',
          onDark ? 'text-white' : 'text-text',
          text,
        )}
      >
        Omlive<span className={onDark ? 'text-white/70' : 'text-primary'}>Stream</span>
      </span>
    </span>
  );

  if (!href) return <div className={cn('inline-flex items-center', className)}>{lockup}</div>;
  return (
    <Link href={href} className={cn('inline-flex items-center', className)} aria-label="OmliveStream">
      {lockup}
    </Link>
  );
}
