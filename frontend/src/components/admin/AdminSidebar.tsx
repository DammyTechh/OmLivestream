'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, MessageSquare, Send, CreditCard, ShieldCheck, LogOut, Activity } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useAdmin } from '@/store/auth';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/admin/dashboard',    label: 'Overview',       icon: LayoutDashboard },
  { href: '/admin/users',        label: 'Users',          icon: Users          },
  { href: '/admin/contact',      label: 'Contact Inbox',  icon: MessageSquare  },
  { href: '/admin/broadcasts',   label: 'Broadcasts',     icon: Send           },
  { href: '/admin/payments',     label: 'Payments',       icon: CreditCard     },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { admin, logout } = useAdmin();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const handleLogout = () => { logout(); router.push('/admin'); };

  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 border-r border-border bg-surface/40 backdrop-blur-sm">
      <div className="p-6 flex items-center justify-between">
        <Logo size="sm" />
        <span className="text-[10px] px-2 py-1 rounded-full bg-primary/15 border border-primary/30 text-primary font-mono">ADMIN</span>
      </div>

      <div className="px-4 mb-4 text-xs">
        <div className="p-3 rounded-xl bg-veil/[0.03] border border-veil/10">
          <div className="text-text font-medium truncate">{admin?.full_name}</div>
          <div className="text-muted capitalize text-[11px]">{admin?.role?.replace('_', ' ')}</div>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={cn('sidebar-link', isActive(item.href) && 'active')}>
            <item.icon size={18} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* The admin area has no top bar, so the theme control lives here beside
          logout — the two footer actions that are about the session rather than
          about navigating the product. */}
      <div className="p-4 border-t border-border flex items-center gap-2">
        <button onClick={handleLogout} className="sidebar-link flex-1 text-left">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
        <ThemeToggle />
      </div>
    </aside>
  );
}
