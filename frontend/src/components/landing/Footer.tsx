import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';
import { SUPPORT_EMAIL, SOCIAL_HANDLE, SOCIAL_URL, type SocialKey } from '@/lib/urls';
import {
  YouTubeIcon, TikTokIcon, InstagramIcon, FacebookIcon, XIcon, ThreadsIcon,
} from '@/components/ui/BrandIcons';

const SOCIALS: { key: SocialKey; label: string; Icon: (p: { size?: number }) => React.ReactNode }[] = [
  { key: 'youtube',   label: 'YouTube',   Icon: YouTubeIcon },
  { key: 'tiktok',    label: 'TikTok',    Icon: TikTokIcon },
  { key: 'instagram', label: 'Instagram', Icon: InstagramIcon },
  { key: 'facebook',  label: 'Facebook',  Icon: FacebookIcon },
  { key: 'x',         label: 'X',         Icon: XIcon },
  { key: 'threads',   label: 'Threads',   Icon: ThreadsIcon },
];

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

        <div className="mt-8 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Official social profiles — the same six platforms a broadcaster
              connects to this product. A link renders only when a handle is
              set, so an unconfigured account disappears rather than 404s. */}
          <div className="flex items-center gap-5">
            {SOCIALS.map(({ key, label, Icon }) => (
              SOCIAL_HANDLE[key] ? (
                <a
                  key={key}
                  href={SOCIAL_URL[key]}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`OmliveStream on ${label}`}
                  className="text-muted hover:text-primary transition"
                >
                  <Icon size={18} />
                </a>
              ) : null
            ))}
          </div>

          <div className="text-xs text-muted">
            Need help?{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-primary hover:underline">
              {SUPPORT_EMAIL}
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
