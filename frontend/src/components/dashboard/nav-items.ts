import {
  LayoutDashboard, Radio, Video, Link2, BarChart3, CreditCard, Settings, Bot,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Single source of truth for the dashboard's primary navigation.
 *
 * Both the desktop `Sidebar` and the mobile `MobileNav` drawer render from this
 * list, so a route added here appears in both without touching two files and
 * without the two menus drifting out of sync.
 */
export const DASHBOARD_NAV: NavItem[] = [
  { href: '/dashboard',            label: 'Overview',   icon: LayoutDashboard },
  { href: '/dashboard/streams',    label: 'Go Live',    icon: Radio          },
  { href: '/dashboard/recordings', label: 'Recordings', icon: Video          },
  { href: '/dashboard/platforms',  label: 'Platforms',  icon: Link2          },
  { href: '/dashboard/analytics',  label: 'Analytics',  icon: BarChart3      },
  { href: '/dashboard/ai',         label: 'AI Studio',  icon: Bot            },
  { href: '/dashboard/billing',    label: 'Billing',    icon: CreditCard     },
  { href: '/dashboard/settings',   label: 'Settings',   icon: Settings       },
];

/** Overview is an exact match; the rest match on prefix (so nested routes stay active). */
export function isNavActive(href: string, pathname: string): boolean {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}
