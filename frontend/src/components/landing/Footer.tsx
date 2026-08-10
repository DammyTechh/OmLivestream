import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';

export function Footer() {
  return (
    <footer className="border-t border-white/5 py-8 mt-12">
      <div className="mx-auto max-w-7xl px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm">
          <Logo size="sm" />
          <p className="text-muted text-xs">© {new Date().getFullYear()} OmliveStream. All rights reserved</p>
          <div className="flex gap-7 text-xs">
            <Link href="/about" className="text-muted hover:text-text transition">About</Link>
            <Link href="/privacy" className="text-muted hover:text-text transition">Privacy</Link>
            <Link href="/terms"   className="text-muted hover:text-text transition">Terms</Link>
            <Link href="/#contact" className="text-muted hover:text-text transition">Contact</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
