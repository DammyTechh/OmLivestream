'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, Radio, CreditCard, Settings, Sparkles, Link2, BellRing } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { acquireSocket, releaseSocket } from '@/lib/socket';
import {
  alreadyPrompted,
  markPrompted,
  notifyPermission,
  requestNotifyPermission,
  showDesktopNotification,
} from '@/lib/notify';

interface Notification {
  id: string;
  title: string;
  body: string;
  type: 'stream' | 'platform' | 'billing' | 'system' | 'ai' | 'promo';
  link?: string | null;
  read_at: string | null;
  created_at: string;
}

const TYPE_META: Record<Notification['type'], { Icon: typeof Bell; color: string }> = {
  stream:   { Icon: Radio,     color: 'text-danger'  },
  platform: { Icon: Link2,     color: 'text-primary' },
  billing:  { Icon: CreditCard, color: 'text-accent'  },
  system:   { Icon: Settings,  color: 'text-muted'   },
  ai:       { Icon: Sparkles,  color: 'text-primary' },
  promo:    { Icon: Sparkles,  color: 'text-success' },
};

/** Rows kept in the dropdown. Matches the server's list limit. */
const MAX_ITEMS = 30;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [askPermission, setAskPermission] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/notifications');
      const d = res.data?.data;
      setItems(d?.items ?? []);
      setUnread(d?.unreadCount ?? 0);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    load();
    // Still polled, but on a much longer interval — the socket below carries
    // anything that arrives while the tab is open, so this is now only a
    // safety net for a dropped connection rather than the delivery mechanism.
    const t = setInterval(load, 5 * 60_000);
    return () => clearInterval(t);
  }, [load]);

  // ── Live delivery ──────────────────────────────────────────────
  useEffect(() => {
    const sock = acquireSocket();
    if (!sock) return;

    const onNew = (n: Notification) => {
      setItems((prev) => {
        // The server may also have been picked up by a poll that raced this
        // event. Two copies of one notification in the list looks like a bug.
        if (prev.some((p) => p.id === n.id)) return prev;
        return [n, ...prev].slice(0, MAX_ITEMS);
      });
      setUnread((c) => c + 1);
      showDesktopNotification(n.title, n.body, n.link ?? undefined);
    };

    sock.on('notification:new', onNew);
    // A reconnect means we were disconnected for some window and missed
    // whatever landed in it, so resynchronise rather than trusting the list.
    sock.on('connect', load);

    return () => {
      sock.off('notification:new', onNew);
      sock.off('connect', load);
      releaseSocket();
    };
  }, [load]);

  // Offer the desktop prompt only once the user has something to be notified
  // about. Asking on first load, before they have any streams, is the request
  // people reflexively deny — and a denial is permanent.
  useEffect(() => {
    if (notifyPermission() === 'default' && !alreadyPrompted() && items.length > 0) {
      setAskPermission(true);
    }
  }, [items.length]);

  const enableDesktop = async () => {
    await requestNotifyPermission();
    setAskPermission(false);
  };

  const dismissPermission = () => {
    markPrompted();
    setAskPermission(false);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markOneRead = async (id: string) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
      setUnread((c) => Math.max(0, c - 1));
    } catch { /* non-fatal */ }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/read-all');
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at || new Date().toISOString() })));
      setUnread(0);
    } catch { /* non-fatal */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative w-10 h-10 rounded-xl bg-veil/5 hover:bg-veil/10 transition flex items-center justify-center"
        aria-label="Notifications"
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-accent text-[10px] font-semibold text-white flex items-center justify-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[22rem] max-w-[90vw] rounded-2xl bg-surface border border-veil/10 shadow-2xl overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-3 border-b border-veil/5">
            <div className="font-display text-base font-semibold">Notifications</div>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-primary hover:underline">
                Mark all read
              </button>
            )}
          </div>

          {askPermission && (
            <div className="flex gap-3 px-4 py-3 bg-primary/[0.06] border-b border-veil/5">
              <BellRing size={15} className="text-primary shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs text-text">Get these on your desktop even when this tab is in the background.</p>
                <div className="flex gap-3 mt-2">
                  {/* Tied to a click: browsers refuse a permission prompt that
                      is not driven by a user gesture. */}
                  <button onClick={enableDesktop} className="text-xs font-medium text-primary hover:underline">
                    Enable
                  </button>
                  <button onClick={dismissPermission} className="text-xs text-muted hover:text-text transition">
                    Not now
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-10 text-center">
                <Bell size={28} className="text-muted mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted">You're all caught up</p>
              </div>
            ) : (
              items.map((n) => {
                const meta = TYPE_META[n.type] ?? TYPE_META.system;
                const isUnread = !n.read_at;
                const inner = (
                  <div
                    onClick={() => isUnread && markOneRead(n.id)}
                    className={`flex gap-3 px-4 py-3 border-b border-veil/5 cursor-pointer transition hover:bg-veil/[0.03] ${isUnread ? 'bg-primary/[0.03]' : ''}`}
                  >
                    <div className={`w-8 h-8 rounded-lg bg-veil/5 flex items-center justify-center shrink-0 ${meta.color}`}>
                      <meta.Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className={`text-sm font-medium truncate ${isUnread ? 'text-text' : 'text-muted'}`}>{n.title}</div>
                        {isUnread && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 mt-1.5" />}
                      </div>
                      <p className="text-xs text-muted line-clamp-2 mt-0.5">{n.body}</p>
                      <p className="text-[10px] text-subtle mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </div>
                );
                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => setOpen(false)}>{inner}</Link>
                ) : (
                  <div key={n.id}>{inner}</div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
