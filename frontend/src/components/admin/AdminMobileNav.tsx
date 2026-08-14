'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, LogOut } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAdmin } from '@/store/auth';
import { cn } from '@/lib/utils';
import { ADMIN_NAV } from './admin-nav';

/**
 * The admin area's navigation on small screens.
 *
 * AdminSidebar is `hidden lg:flex`, and unlike the main app the admin section
 * has no top bar at all — so below `lg` there was no logo, no theme control and
 * no way to reach another admin page. This supplies all three as a compact
 * sticky bar plus a drawer, and disappears entirely at `lg` where the rail
 * takes over.
 *
 * The drawer is portalled to <body> for the same reason as the main app's: the
 * bar is sticky and backdrop-blurred, and both of those create stacking
 * contexts that would otherwise trap a fixed child inside the header's layer.
 */
export function AdminMobileNav() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { admin, logout } = useAdmin();

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');
  const handleLogout = () => { logout(); router.push('/admin'); };

  return (
    <div className="lg:hidden sticky top-0 z-30 bg-bg/85 backdrop-blur-xl border-b border-border">
      <div className="px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open admin menu"
            aria-expanded={open}
            className="w-10 h-10 -ml-1 flex items-center justify-center rounded-xl text-text hover:bg-veil/5 transition shrink-0"
          >
            <Menu size={22} />
          </button>
          <Logo size="sm" href="/admin/dashboard" />
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-primary/10 border border-primary/25 text-primary font-mono shrink-0">
          ADMIN
        </span>
      </div>

      {mounted && createPortal(
        <AnimatePresence>
          {open && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-[100] bg-veil/40 backdrop-blur-sm lg:hidden"
              />
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

                <div className="px-4 pt-4 text-xs">
                  <div className="p-3 rounded-xl bg-veil/[0.03] border border-border">
                    <div className="text-text font-medium truncate">{admin?.full_name}</div>
                    <div className="text-muted capitalize text-[11px]">{admin?.role?.replace('_', ' ')}</div>
                  </div>
                </div>

                <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
                  {ADMIN_NAV.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      className={cn('sidebar-link', isActive(item.href) && 'active')}
                    >
                      <item.icon size={18} />
                      <span>{item.label}</span>
                    </Link>
                  ))}
                </nav>

                <div className="p-3 border-t border-border flex items-center gap-2">
                  <button onClick={handleLogout} className="sidebar-link flex-1 text-left">
                    <LogOut size={18} />
                    <span>Logout</span>
                  </button>
                  <ThemeToggle />
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
