import { LayoutDashboard, Users, MessageSquare, Send, CreditCard, type LucideIcon } from 'lucide-react';

export interface AdminNavItem { href: string; label: string; icon: LucideIcon; }

/**
 * Single source of truth for admin navigation, shared by the desktop rail and
 * the mobile drawer so a new admin page appears in both without editing two
 * files.
 */
export const ADMIN_NAV: AdminNavItem[] = [
  { href: '/admin/dashboard',  label: 'Overview',      icon: LayoutDashboard },
  { href: '/admin/users',      label: 'Users',         icon: Users           },
  { href: '/admin/contact',    label: 'Contact Inbox', icon: MessageSquare   },
  { href: '/admin/broadcasts', label: 'Broadcasts',    icon: Send            },
  { href: '/admin/payments',   label: 'Payments',      icon: CreditCard      },
];
