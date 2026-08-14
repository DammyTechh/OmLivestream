'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Send, Plus, Clock, Check, X, Users, Calendar } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { api, unwrap } from '@/lib/api';
import { formatDate, timeAgo } from '@/lib/utils';

interface Broadcast {
  id: string;
  subject: string;
  segment: string;
  status: string;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
}

interface Stats {
  total_sent?: number;
  total_opened?: number;
  active_campaigns?: number;
}

function BroadcastsContent() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [stats, setStats] = useState<Stats>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [l, s] = await Promise.all([
          api.get('/admin/broadcasts?limit=50').then(r => r.data?.data || []).catch(() => []),
          api.get('/admin/broadcasts/stats').then(r => r.data?.data || {}).catch(() => ({})),
        ]);
        setItems(l as Broadcast[]);
        setStats(s as Stats);
      } finally { setLoading(false); }
    })();
  }, []);

  const statusColor = (s: string) => {
    const map: Record<string, string> = {
      draft:      'bg-veil/10 text-muted',
      scheduled:  'bg-primary/15 text-primary',
      sending:    'bg-warning/15 text-warning',
      sent:       'bg-success/15 text-success',
      cancelled:  'bg-veil/10 text-subtle',
      failed:     'bg-danger/15 text-danger',
    };
    return map[s] || 'bg-veil/10 text-muted';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Email Broadcasts</h1>
          <p className="text-muted mt-1">Send targeted campaigns to user segments.</p>
        </div>
        <Link href="/admin/broadcasts/new">
          <Button icon={<Plus size={16} />}>Compose</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <Send size={18} className="text-primary mb-3" />
          <div className="font-display text-3xl font-semibold">{stats.total_sent?.toLocaleString() ?? 0}</div>
          <div className="text-xs text-muted mt-1">Emails sent</div>
        </Card>
        <Card className="p-5">
          <Users size={18} className="text-accent mb-3" />
          <div className="font-display text-3xl font-semibold">{stats.total_opened?.toLocaleString() ?? 0}</div>
          <div className="text-xs text-muted mt-1">Total opens</div>
        </Card>
        <Card className="p-5">
          <Calendar size={18} className="text-success mb-3" />
          <div className="font-display text-3xl font-semibold">{stats.active_campaigns ?? 0}</div>
          <div className="text-xs text-muted mt-1">Active campaigns</div>
        </Card>
      </div>

      {/* List */}
      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : items.length === 0 ? (
        <Card className="py-14 text-center">
          <Send size={40} className="text-muted mx-auto mb-4" />
          <h3 className="font-display text-xl mb-2">No broadcasts yet</h3>
          <p className="text-muted mb-6">Create your first email campaign.</p>
          <Link href="/admin/broadcasts/new">
            <Button icon={<Plus size={16} />}>Compose broadcast</Button>
          </Link>
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((b) => (
            <Card key={b.id} className="p-5 hover:border-primary/30 transition">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <span className="font-medium truncate">{b.subject}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full capitalize ${statusColor(b.status)}`}>{b.status}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                    <span className="capitalize">Segment: {b.segment.replace('_', ' ')}</span>
                    <span>·</span>
                    <span>{b.recipient_count?.toLocaleString() ?? 0} recipients</span>
                    <span>·</span>
                    <span>{b.sent_count?.toLocaleString() ?? 0} sent</span>
                    {b.failed_count > 0 && <>
                      <span>·</span>
                      <span className="text-danger">{b.failed_count} failed</span>
                    </>}
                  </div>
                </div>
                <div className="text-xs text-muted shrink-0">
                  {b.sent_at ? `Sent ${timeAgo(b.sent_at)}` :
                   b.scheduled_at ? `Scheduled ${formatDate(b.scheduled_at)}` :
                   `Created ${timeAgo(b.created_at)}`}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Page() { return <BroadcastsContent />; }
