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
  const dims  = { sm: { w: 110, h: 24 }, md: { w: 150, h: 32 }, lg: { w: 200, h: 44 } };
  const { w, h } = dims[size];

  const img = (
    <Image
      src="https://i.imgur.com/0NFlGxJ.png"
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
