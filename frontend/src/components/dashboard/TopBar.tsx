'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, User as UserIcon, LogOut, Settings, CreditCard, ChevronDown } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { useState, useEffect, useRef } from 'react';
import { NotificationBell } from './NotificationBell';
import { ThemeToggle } from '@/components/theme/ThemeToggle';

export function TopBar() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const initial = user?.full_name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?';

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const handleLogout = () => {
    logout();
    router.push('/');
  };

  return (
    <div className="sticky top-0 z-30 bg-bg/80 backdrop-blur-xl border-b border-border">
      <div className="px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            placeholder="Search streams, recordings, platforms…"
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-veil/[0.03] border border-veil/10 text-sm focus:border-primary/60 focus:bg-veil/[0.05] focus:outline-none placeholder:text-muted"
          />
        </div>

        <div className="flex items-center gap-1 sm:gap-2">
          <ThemeToggle />
          <NotificationBell />

          {/* Profile dropdown */}
          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex items-center gap-3 pl-3 border-l border-border hover:opacity-90 transition"
            >
              <div className="text-right hidden sm:block">
                <div className="text-sm font-medium leading-tight">{user?.full_name ?? 'Creator'}</div>
                <div className="text-xs text-muted capitalize leading-tight">{user?.plan?.replace('_', ' ')}</div>
              </div>
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-accent flex items-center justify-center font-semibold text-white">
                  {initial}
                </div>
              )}
              <ChevronDown size={14} className={`text-muted transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-surface border border-veil/10 shadow-2xl overflow-hidden py-2 z-50">
                <div className="px-4 py-3 border-b border-veil/5">
                  <div className="text-sm font-semibold truncate">{user?.full_name ?? 'Creator'}</div>
                  <div className="text-xs text-muted truncate">{user?.email}</div>
                </div>

                <Link href="/dashboard/settings" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-veil/5 transition">
                  <UserIcon size={16} className="text-muted" /> My Profile
                </Link>
                <Link href="/dashboard/settings" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-veil/5 transition">
                  <Settings size={16} className="text-muted" /> Settings
                </Link>
                <Link href="/dashboard/billing" onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-veil/5 transition">
                  <CreditCard size={16} className="text-muted" /> Billing
                </Link>

                <div className="border-t border-veil/5 my-1" />
                <button onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-danger hover:bg-danger/10 transition">
                  <LogOut size={16} /> Log out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
