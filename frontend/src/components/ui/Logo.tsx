import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Logo({
  className,
  size = 'md',
  href = '/',
}: {
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  href?: string | null;
}) {
  // Heights, not widths: the lockup is a fixed 366x71 of ink (trimmed to the
  // glyphs in public/logo.webp), so pinning the height is what keeps it
  // optically consistent with the text next to it at every size.
  const dims = { sm: { h: 24 }, md: { h: 32 }, lg: { h: 44 } };
  const { h } = dims[size];
  const w = Math.round(h * (366 / 71));

  const img = (
    <Image
      src="/logo.webp"
      alt="OmliveStream"
      width={w * 2}
      height={h * 2}
      style={{ width: w, height: 'auto' }}
      className="drop-shadow-[0_0_20px_rgba(168,85,247,0.25)]"
      priority
    />
  );

  if (!href) return <div className={className}>{img}</div>;
  return (
    <Link href={href} className={cn('inline-flex items-center group', className)}>
      {img}
    </Link>
  );
}
