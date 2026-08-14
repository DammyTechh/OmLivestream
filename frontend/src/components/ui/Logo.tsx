import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The brand lockup: the orb mark plus the OmliveStream wordmark.
 *
 * The mark is the original artwork, served from public/logo-mark.webp (the orb
 * cropped out of the full logo so it can sit next to live text). It is a plain
 * <img> rather than next/image: it is 3.7KB, it never needs resizing, and
 * going direct avoids depending on the image optimizer resolving correctly
 * behind the subdomain rewrites.
 *
 * It renders on every host now that the middleware stops rewriting static file
 * paths — `/logo-mark.webp` on dashboard.omlivestream.com was being turned into
 * `/dashboard/logo-mark.webp`, which is why the mark showed as a broken image
 * across the subdomains.
 *
 * The wordmark stays live text so it can follow the theme. The original raster
 * set "Omlive" in a pale lavender tuned for a dark page, which disappeared on
 * the light theme; as text it takes the theme's ink colour and is legible in
 * both. `tone="onDark"` pins it to white for surfaces that stay dark whatever
 * the theme — the sign-in illustration panel, the email header.
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
  /** 'onDark' for surfaces that stay dark in both themes. */
  tone?: 'auto' | 'onDark';
}) {
  const dims = {
    sm: { h: 28, text: 'text-lg'  },
    md: { h: 34, text: 'text-2xl' },
    lg: { h: 44, text: 'text-3xl' },
  } as const;
  const { h, text } = dims[size];
  const onDark = tone === 'onDark';

  const lockup = (
    <span className="inline-flex items-center gap-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-mark.webp"
        alt=""
        width={h}
        height={h}
        style={{ width: h, height: h }}
        className="shrink-0 select-none"
        draggable={false}
      />
      <span
        className={cn(
          'font-semibold tracking-tight leading-none whitespace-nowrap',
          onDark ? 'text-white' : 'text-text',
          text,
        )}
      >
        Omlive<span className={onDark ? 'text-white/75' : 'text-primary'}>Stream</span>
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
