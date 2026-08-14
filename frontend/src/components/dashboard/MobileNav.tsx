'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, LogOut } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { paymentUrl } from '@/lib/surface-links';
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
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  // Portals need a DOM; render nothing on the server pass.
  useEffect(() => { setMounted(true); }, []);

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

      {/* Rendered into <body>, not in place.

          The dashboard TopBar is `sticky z-30` with `backdrop-blur-xl`, and
          each of those creates a stacking context on its own. A `fixed` drawer
          declared inside it is therefore trapped in the header's z-30 layer no
          matter how high its own z-index goes, which is why the panel appeared
          tangled with the page content instead of over it. A portal moves it
          out to the document root, where z-[100] means what it says. */}
      {mounted && createPortal(
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
                className="fixed inset-0 z-[100] bg-veil/40 backdrop-blur-sm lg:hidden"
              />

              {/* Drawer */}
              <motion.aside
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'tween', duration: 0.25, ease: 'easeOut' }}
                className="fixed left-0 top-0 z-[101] flex h-full w-[82%] max-w-xs flex-col
                           bg-bg border-r border-border shadow-2xl lg:hidden"
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
                  <div className="mx-3 mb-3 p-4 rounded-2xl bg-veil/[0.04] border border-border">
                    <div className="text-xs font-semibold mb-1">Upgrade to Premium</div>
                    <p className="text-xs text-muted mb-3">Stream to all 8 platforms. Reply to comments. AI video editing.</p>
                    <Link
                      href={paymentUrl("?plan=premium")}
                      onClick={() => setOpen(false)}
                      className="block w-full text-center py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition"
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
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
