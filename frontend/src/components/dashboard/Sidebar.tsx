'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { paymentUrl } from '@/lib/surface-links';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';
import { DASHBOARD_NAV, isNavActive } from './nav-items';

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = () => { logout(); router.push('/'); };

  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 border-r border-veil/5 bg-bg">
      <div className="p-6">
        <Logo size="sm" />
      </div>

      <nav data-tour="desktop-nav" className="flex-1 px-4 space-y-1 overflow-y-auto">
        {DASHBOARD_NAV.map((item) => (
          <Link key={item.href} href={item.href} className={cn('sidebar-link', isNavActive(item.href, pathname) && 'active')}>
            <item.icon size={18} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {user?.plan !== 'premium' && (
        <div className="mx-4 mb-4 p-4 rounded-2xl bg-veil/[0.04] border border-border">
          <div className="text-xs font-semibold mb-1.5">Upgrade to Premium</div>
          <p className="text-xs text-muted mb-3">Stream to all 8 platforms. Reply to comments. AI video editing.</p>
          <Link href={paymentUrl("?plan=premium")} className="block w-full text-center py-2 rounded-xl bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition">
            Upgrade
          </Link>
        </div>
      )}

      <div className="p-4 border-t border-veil/5">
        <button onClick={handleLogout} className="sidebar-link w-full text-left">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
