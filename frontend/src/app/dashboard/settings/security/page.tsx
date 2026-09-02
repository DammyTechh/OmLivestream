'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ShieldCheck, Monitor, LogOut, AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { api, unwrap, getApiError } from '@/lib/api';

/**
 * Security settings.
 *
 * This page exists because the "New device sign-in" email already linked here
 * — `/settings/security` — and the route did not exist. Someone who received a
 * genuine security alert, clicked "Secure my account", and landed on a 404 is
 * left with an alarming email and no way to act on it, which is worse than
 * sending no alert at all.
 *
 * The endpoints were all already there (`/users/me/sessions`,
 * `/users/me/login-history`); nothing had ever surfaced them.
 */

interface Session {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  last_seen_at: string | null;
  created_at: string;
  expires_at: string | null;
}

interface LoginLog {
  id: string;
  ip_address: string | null;
  user_agent: string | null;
  is_new_device: boolean;
  risk_level: string | null;
  created_at: string;
}

/** "Chrome on Windows" beats a 180-character UA string nobody can read. */
function friendlyDevice(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\//.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Safari\//.test(ua) ? 'Safari' :
    /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /iPhone|iPad/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

function when(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SecuritySettingsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [history, setHistory] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Settled, not all: a failing history call should not blank the session
    // list, which is the part someone acts on during a real incident.
    const [s, h] = await Promise.allSettled([
      api.get('/users/me/sessions').then(unwrap<Session[]>),
      api.get('/users/me/login-history', { params: { limit: 10 } }).then(unwrap<LoginLog[]>),
    ]);
    if (s.status === 'fulfilled') setSessions(Array.isArray(s.value) ? s.value : []);
    if (h.status === 'fulfilled') setHistory(Array.isArray(h.value) ? h.value : []);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await api.delete(`/users/me/sessions/${id}`);
      setSessions((s) => s.filter((x) => x.id !== id));
      toast.success('That device has been signed out.');
    } catch (err) {
      toast.error(getApiError(err));
    } finally {
      setBusy(null);
    }
  };

  const revokeAll = async () => {
    if (!confirm('Sign out of every device, including this one? You will need to sign in again.')) return;
    setBusy('all');
    try {
      await api.post('/users/me/sessions/revoke-all');
      toast.success('Signed out everywhere. Please sign in again.');
      // This session is gone too, so send them to sign-in rather than leaving
      // a dead page that 401s on every subsequent action.
      setTimeout(() => { window.location.href = '/auth/signin'; }, 1200);
    } catch (err) {
      toast.error(getApiError(err));
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href="/dashboard/settings"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition mb-4"
        >
          <ArrowLeft size={14} /> Settings
        </Link>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Security</h1>
        <p className="text-muted mt-1">Devices signed into your account, and recent activity.</p>
      </div>

      {/* Active sessions */}
      <Card className="p-0">
        <div className="flex items-center gap-3 p-5 border-b border-border">
          <Monitor size={18} className="text-muted" />
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold">Active sessions</h2>
            <p className="text-sm text-muted mt-0.5">Every device currently signed in.</p>
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="p-5 text-sm text-muted">No other active sessions.</p>
        ) : (
          sessions.map((s, i) => (
            <div
              key={s.id}
              className={`flex items-center gap-4 p-5 ${i > 0 ? 'border-t border-border' : ''}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{friendlyDevice(s.user_agent)}</div>
                <div className="text-xs text-muted mt-1">
                  {s.ip_address ?? 'Unknown IP'} · Last active {when(s.last_seen_at ?? s.created_at)}
                </div>
              </div>
              <button
                onClick={() => revoke(s.id)}
                disabled={busy === s.id}
                className="text-xs font-medium text-danger hover:underline disabled:opacity-50 shrink-0"
              >
                {busy === s.id ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ))
        )}
      </Card>

      {/* Emergency */}
      <Card className="border-danger/30">
        <div className="flex items-start gap-4 flex-wrap">
          <AlertTriangle size={19} className="text-danger mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-lg font-semibold">Sign out everywhere</h2>
            <p className="text-sm text-muted mt-1 mb-4 max-w-xl">
              If you think someone else has access to your account, this ends every
              session immediately — including this one. Any live broadcast will stop.
            </p>
            <Button variant="danger" onClick={revokeAll} loading={busy === 'all'} icon={<LogOut size={16} />}>
              Sign out of all devices
            </Button>
          </div>
        </div>
      </Card>

      {/* Recent activity */}
      <Card className="p-0">
        <div className="flex items-center gap-3 p-5 border-b border-border">
          <ShieldCheck size={18} className="text-muted" />
          <div>
            <h2 className="font-display text-lg font-semibold">Recent sign-ins</h2>
            <p className="text-sm text-muted mt-0.5">The last 10 attempts on your account.</p>
          </div>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center">
            <Loader2 size={20} className="animate-spin text-muted" />
          </div>
        ) : history.length === 0 ? (
          <p className="p-5 text-sm text-muted">No sign-in history yet.</p>
        ) : (
          history.map((h, i) => (
            <div key={h.id} className={`flex items-center gap-4 p-5 ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="text-sm flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{friendlyDevice(h.user_agent)}</span>
                  {h.is_new_device && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning font-semibold uppercase">
                      New device
                    </span>
                  )}
                  {h.risk_level === 'high' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-danger/15 text-danger font-semibold uppercase">
                      High risk
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted mt-1">
                  {h.ip_address ?? 'Unknown IP'} · {when(h.created_at)}
                </div>
              </div>
            </div>
          ))
        )}
      </Card>

      <p className="text-sm text-muted">
        Seeing something you don&apos;t recognise? Sign out of all devices above, then
        contact{' '}
        <a href="mailto:support@omlivestream.com" className="text-primary hover:underline">
          support@omlivestream.com
        </a>
        .
      </p>
    </div>
  );
}
