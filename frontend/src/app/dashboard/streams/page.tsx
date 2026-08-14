'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Radio, Plus, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { timeAgo } from '@/lib/utils';

interface Stream {
  id: string;
  title: string;
  status: 'scheduled' | 'live' | 'ended';
  created_at: string;
}

export default function StreamsPage() {
  const [streams, setStreams] = useState<Stream[]>([]);
  const [filter, setFilter] = useState<'all' | 'live' | 'scheduled' | 'ended'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const url = filter === 'all' ? '/streams?limit=50' : `/streams?status=${filter}&limit=50`;
        const res = await api.get(url);
        setStreams(res.data?.data || []);
      } catch {
        setStreams([]);
      } finally { setLoading(false); }
    })();
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Your Streams</h1>
          <p className="text-muted mt-1">All your broadcasts, past and scheduled.</p>
        </div>
        <Link href="/dashboard/streams/new">
          <Button icon={<Plus size={16} />} className="w-full sm:w-auto whitespace-nowrap">New Stream</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'live', 'scheduled', 'ended'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-full text-sm font-medium capitalize transition ${
              filter === f ? 'bg-primary text-white' : 'bg-veil/5 text-muted hover:bg-veil/10'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : streams.length === 0 ? (
        <Card className="py-14 text-center">
          <Radio size={40} className="text-muted mx-auto mb-4" />
          <h3 className="font-display text-xl mb-2">No streams in this category</h3>
          <p className="text-muted">Create your first stream to get started.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {streams.map((s) => (
            <Link key={s.id} href={`/dashboard/streams/${s.id}`}>
              <Card className="p-5 hover:border-primary/30 transition cursor-pointer">
                <div className="flex items-center gap-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                    s.status === 'live' ? 'bg-danger/20' :
                    s.status === 'scheduled' ? 'bg-primary/20' : 'bg-veil/5'
                  }`}>
                    <Radio size={18} className={
                      s.status === 'live' ? 'text-danger animate-pulse' :
                      s.status === 'scheduled' ? 'text-primary' : 'text-muted'
                    } />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{s.title}</div>
                    <div className="flex items-center gap-2 text-xs text-muted mt-0.5">
                      <Clock size={11} /> {timeAgo(s.created_at)}
                      <span>·</span>
                      <span className="capitalize">{s.status}</span>
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
