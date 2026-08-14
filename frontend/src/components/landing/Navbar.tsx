'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Logo } from '@/components/ui/Logo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Menu, X, LayoutDashboard, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TOKEN_KEYS } from '@/lib/api';
import { tokenStore } from '@/lib/token-store';
import { resetSocket } from '@/lib/socket';

export function Navbar() {
  const [open, setOpen] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);
  const [userInitial, setUserInitial] = useState<string | null>(null);
  const pathname = usePathname();
  const router = useRouter();
  const { scrollY } = useScroll();
  const bgBlur = useTransform(scrollY, [0, 100], [0.3, 0.85]);

  useEffect(() => {
    // Check auth state on every pathname change (for when user navigates back to /)
    const token = typeof window !== 'undefined' ? tokenStore.get(TOKEN_KEYS.ACCESS) : null;
    setIsAuthed(!!token);
    if (token) {
      try {
        const userStr = localStorage.getItem(TOKEN_KEYS.USER);
        if (userStr) {
          const user = JSON.parse(userStr);
          setUserInitial((user.full_name?.[0] ?? user.email?.[0] ?? '?').toUpperCase());
        }
      } catch {
        setUserInitial('?');
      }
    }
  }, [pathname]);

  const NAV = [
    { href: '/',          label: 'Home'     },
    { href: '/#features', label: 'Features' },
    { href: '/#pricing',  label: 'Pricing'  },
  ];

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const logout = () => {
    tokenStore.remove(TOKEN_KEYS.ACCESS);
    tokenStore.remove(TOKEN_KEYS.REFRESH);
    localStorage.removeItem(TOKEN_KEYS.USER);
    resetSocket();
    setIsAuthed(false);
    setOpen(false);
    router.push('/');
  };

  return (
    <motion.nav
      style={{ backdropFilter: `blur(${bgBlur.get() * 20}px)` }}
      className="sticky top-0 z-40 bg-bg/80 border-b border-border"
    >
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
        <Logo />

        <div className="hidden md:flex items-center gap-10 absolute left-1/2 -translate-x-1/2">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                'text-[15px] transition-colors',
                isActive(n.href) ? 'text-primary font-medium' : 'text-text hover:text-primary'
              )}
            >
              {n.label}
            </Link>
          ))}
        </div>

        {/* The toggle sits outside the `hidden md:flex` cluster so it stays
            reachable on mobile without opening the hamburger menu — the theme
            is a viewing preference, not a navigation destination. */}
        <div className="flex items-center gap-2">
          <ThemeToggle />

          <div className="hidden md:flex items-center gap-3">
            {isAuthed ? (
              <>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-[15px] font-semibold hover:bg-primary/90 transition shadow-brand"
                >
                  <LayoutDashboard size={16} />
                  Dashboard
                </Link>
                <button
                  onClick={logout}
                  className="w-10 h-10 rounded-full bg-primary flex items-center justify-center font-semibold text-white text-sm hover:scale-105 transition"
                  title="Log out"
                >
                  {userInitial ?? '?'}
                </button>
              </>
            ) : (
              <>
                <Link href="/auth/signin" className="text-[15px] text-muted hover:text-text transition">Sign In</Link>
                <Link
                  href="/auth/signup"
                  className="px-6 py-2.5 rounded-xl bg-primary text-white text-[15px] font-semibold hover:bg-primary/90 transition shadow-brand"
                >
                  Sign Up
                </Link>
              </>
            )}
          </div>

          <button className="md:hidden text-text" onClick={() => setOpen(!open)} aria-label="Menu">
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden border-t border-border px-6 py-4 flex flex-col gap-3 bg-bg"
        >
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="text-text py-2" onClick={() => setOpen(false)}>
              {n.label}
            </Link>
          ))}
          {isAuthed ? (
            <>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 px-4 py-3 text-center rounded-xl bg-primary text-white font-semibold mt-2"
              >
                <LayoutDashboard size={16} /> Dashboard
              </Link>
              <button
                onClick={logout}
                className="flex items-center justify-center gap-2 px-4 py-3 text-center rounded-xl bg-veil/5 text-muted font-medium"
              >
                <LogOut size={16} /> Log out
              </button>
            </>
          ) : (
            <>
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-center rounded-xl bg-veil/5 text-text font-medium mt-2"
              >
                Sign In
              </Link>
              <Link
                href="/auth/signup"
                onClick={() => setOpen(false)}
                className="px-4 py-3 text-center rounded-xl bg-primary text-white font-semibold"
              >
                Sign Up
              </Link>
            </>
          )}
        </motion.div>
      )}
    </motion.nav>
  );
}
