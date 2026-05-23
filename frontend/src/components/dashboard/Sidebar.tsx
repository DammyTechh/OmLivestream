'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Radio, Video, Link2, BarChart3, CreditCard, Settings, LifeBuoy, LogOut, Sparkles, Bot } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard',            label: 'Overview',    icon: LayoutDashboard },
  { href: '/dashboard/streams',    label: 'Go Live',     icon: Radio          },
  { href: '/dashboard/recordings', label: 'Recordings',  icon: Video          },
  { href: '/dashboard/platforms',  label: 'Platforms',   icon: Link2          },
  { href: '/dashboard/analytics',  label: 'Analytics',   icon: BarChart3      },
  { href: '/dashboard/ai',         label: 'AI Studio',   icon: Bot            },
  { href: '/dashboard/billing',    label: 'Billing',     icon: CreditCard     },
  { href: '/dashboard/settings',   label: 'Settings',    icon: Settings       },
];

export function Sidebar() {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, logout } = useAuth();

  const isActive = (href: string) =>
    href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);

  const handleLogout = () => { logout(); router.push('/'); };

  return (
    <aside className="hidden lg:flex flex-col w-64 h-screen sticky top-0 border-r border-white/5 bg-[#0D0A1E]">
      <div className="p-6">
        <Logo size="sm" />
      </div>

      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className={cn('sidebar-link', isActive(item.href) && 'active')}>
            <item.icon size={18} />
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {user?.plan !== 'premium' && (
        <div className="mx-4 mb-4 p-4 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10 border border-primary/30">
          <div className="flex items-center gap-2 mb-1.5">
            <Sparkles size={14} className="text-primary" />
            <span className="text-xs font-semibold">Upgrade to Premium</span>
          </div>
          <p className="text-xs text-muted mb-3">Stream to all 8 platforms. Reply to comments. AI video editing.</p>
          <Link href="/payment?plan=premium" className="block w-full text-center py-2 rounded-xl bg-white/10 text-xs font-semibold hover:bg-white/15 transition">
            Upgrade
          </Link>
        </div>
      )}

      <div className="p-4 border-t border-white/5">
        <button onClick={handleLogout} className="sidebar-link w-full text-left">
          <LogOut size={18} />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
