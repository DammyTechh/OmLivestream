'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, LogOut, Sparkles } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { DASHBOARD_NAV, isNavActive } from './nav-items';

/**
 * The dashboard sidebar is `hidden lg:flex`, so below `lg` there was no way to
 * move between dashboard pages at all. This is that navigation for small
 * screens: a hamburger in the top bar that opens a left drawer with the same
 * links (from the shared DASHBOARD_NAV), plus the upgrade card and logout the
 * desktop rail carries. It renders nothing at `lg` and up, where the real
 * sidebar takes over.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  // Close on navigation — tapping a link should feel like it took you there,
  // not leave the drawer sitting open over the new page.
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll while the drawer is open so the page behind doesn't move.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape closes it, matching the backdrop tap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const handleLogout = () => { logout(); router.push('/'); };

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="mobile-nav"
        aria-label="Open menu"
        aria-expanded={open}
        className="w-10 h-10 -ml-1 flex items-center justify-center rounded-xl text-text hover:bg-veil/5 transition"
      >
        <Menu size={22} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-veil/40 backdrop-blur-sm"
            />

            {/* Drawer */}
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
              className="fixed left-0 top-0 z-50 flex h-full w-[82%] max-w-xs flex-col
                         bg-bg border-r border-border shadow-2xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="flex items-center justify-between p-5 border-b border-border">
                <Logo size="sm" href={null} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="w-9 h-9 flex items-center justify-center rounded-xl text-muted hover:text-text hover:bg-veil/5 transition"
                >
                  <X size={20} />
                </button>
              </div>

              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                {DASHBOARD_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn('sidebar-link', isNavActive(item.href, pathname) && 'active')}
                  >
                    <item.icon size={18} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </nav>

              {user?.plan !== 'premium' && (
                <div className="mx-3 mb-3 p-4 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10 border border-primary/30">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles size={14} className="text-primary" />
                    <span className="text-xs font-semibold">Upgrade to Premium</span>
                  </div>
                  <p className="text-xs text-muted mb-3">Stream to all 8 platforms. Reply to comments. AI video editing.</p>
                  <Link
                    href="/payment?plan=premium"
                    onClick={() => setOpen(false)}
                    className="block w-full text-center py-2 rounded-xl bg-veil/10 text-xs font-semibold hover:bg-veil/15 transition"
                  >
                    Upgrade
                  </Link>
                </div>
              )}

              <div className="p-3 border-t border-border">
                <button onClick={handleLogout} className="sidebar-link w-full text-left">
                  <LogOut size={18} />
                  <span>Logout</span>
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
