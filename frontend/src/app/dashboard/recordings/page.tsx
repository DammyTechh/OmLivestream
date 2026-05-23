'use client';
import { useEffect, useState } from 'react';
import { Video, Download, Wand2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { api, getApiError, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/utils';

interface Recording {
  id: string;
  stream_id: string;
  file_url: string | null;
  duration_seconds: number | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
}

export default function RecordingsPage() {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/recordings?limit=50');
        setRecordings(res.data?.data || []);
      } finally { setLoading(false); }
    })();
  }, []);

  const formatDuration = (sec: number | null) => {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this recording?')) return;
    try {
      await api.delete(`/recordings/${id}`);
      setRecordings(recordings.filter(r => r.id !== id));
      toast.success('Deleted');
    } catch (err) { toast.error(getApiError(err)); }
  };

  const edit = async (id: string) => {
    const prompt = window.prompt('Describe the edits you want (AI will apply them):', 'Trim first 2 minutes, add captions');
    if (!prompt) return;
    try {
      await api.post(`/recordings/${id}/ai-edit`, { prompt });
      toast.success('AI edit queued — check back soon');
    } catch (err) { toast.error(getApiError(err)); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Recordings</h1>
        <p className="text-muted mt-1">Every stream, automatically saved — edit, download, or republish.</p>
      </div>

      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : recordings.length === 0 ? (
        <Card className="py-14 text-center">
          <Video size={40} className="text-muted mx-auto mb-4" />
          <h3 className="font-display text-xl mb-2">No recordings yet</h3>
          <p className="text-muted">Start a stream — we'll save the recording automatically.</p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {recordings.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                    <Video size={20} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">Recording · {r.id.slice(0, 8)}</div>
                    <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                      <span>{formatDate(r.created_at)}</span>
                      <span>·</span>
                      <span>{formatDuration(r.duration_seconds)}</span>
                      <span>·</span>
                      <span className={`capitalize ${
                        r.status === 'ready' ? 'text-success' :
                        r.status === 'processing' ? 'text-warning' : 'text-danger'
                      }`}>{r.status}</span>
                    </div>
                  </div>
                </div>
                {r.status === 'ready' && (
                  <div className="flex gap-2">
                    <button onClick={() => edit(r.id)} className="p-2 rounded-xl bg-white/5 hover:bg-primary/20 text-muted hover:text-primary transition" title="AI edit">
                      <Wand2 size={16} />
                    </button>
                    {r.file_url && (
                      <a href={r.file_url} download className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-muted hover:text-text transition" title="Download">
                        <Download size={16} />
                      </a>
                    )}
                    <button onClick={() => remove(r.id)} className="p-2 rounded-xl bg-white/5 hover:bg-danger/20 text-muted hover:text-danger transition" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
