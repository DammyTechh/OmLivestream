'use client';
import { useEffect, useState } from 'react';
import { Video, Download, Wand2, Trash2, Play, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { api, getApiError, unwrap } from '@/lib/api';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { formatDate } from '@/lib/utils';

interface Recording {
  id: string;
  stream_id: string;
  file_url: string | null;
  /**
   * A short-lived signed URL from the API.
   *
   * `file_url` is the public-style URL recorded at upload time, and the
   * recordings bucket is private — following it returns "Bucket not found".
   * Every play/download action must use this instead.
   */
  signedUrl?: string | null;
  /**
   * A second signed URL carrying `Content-Disposition: attachment`.
   *
   * HTML's `download` attribute is ignored cross-origin, and storage is a
   * different origin — so the plain link navigated to the file and played it
   * rather than saving it. This one the browser must save, whatever the
   * origin, and it arrives named after the broadcast rather than
   * "recording.mp4".
   */
  downloadUrl?: string | null;
  /** The parent stream, joined by the API — used for the display title. */
  streams?: { title?: string | null; started_at?: string | null } | null;
  duration_seconds: number | null;
  status: 'processing' | 'ready' | 'failed';
  created_at: string;
}

export default function RecordingsPage() {
  const confirm = useConfirm();
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/recordings?limit=50');
        // Shape-checked: a 200 with an unexpected body would otherwise reach
        // .map() and blank the page.
        setRecordings(Array.isArray(res.data?.data) ? res.data.data : []);
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
    if (!(await confirm({
      title: 'Delete this recording?',
      message: 'The video file and its edits are removed permanently. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    }))) return;
    try {
      await api.delete(`/recordings/${id}`);
      setRecordings(recordings.filter(r => r.id !== id));
      toast.success('Deleted');
    } catch (err) { toast.error(getApiError(err)); }
  };

  const edit = async (id: string) => {
    const prompt = await confirm({
      title: 'AI edit',
      message: 'Describe what you want changed and the AI will apply it to a copy. Your original recording is never modified.',
      confirmLabel: 'Start edit',
      input: {
        label: 'What should it do?',
        placeholder: 'Trim the first 2 minutes, add captions, remove long pauses…',
        defaultValue: 'Trim first 2 minutes, add captions',
        // A textarea, because a useful instruction is a sentence or two and a
        // single-line field encourages the one-word prompts that produce poor
        // edits.
        multiline: true,
        validate: (v) => v.trim().length >= 4,
        hint: 'Describe the edit in a few words.',
      },
    });
    if (typeof prompt !== 'string' || !prompt.trim()) return;
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
                {/* Stacks on a phone. A single row with the actions pinned
                    right squeezed the title to "Recordi…" on a 390px screen
                    and pushed four buttons on top of the date. Below `sm`
                    the text gets full width and the actions sit under it. */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0">
                    <Video size={20} className="text-primary" />
                  </div>
                  <div className="min-w-0">
                      {/* The broadcast's own title. It was already being
                          selected by the API and ignored, so every row read
                          "Recording · 6d62723e" — a database id, which says
                          nothing about which broadcast it was. */}
                      <div className="font-medium truncate">
                        {r.streams?.title?.trim() || `Recording · ${r.id.slice(0, 8)}`}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted mt-1">
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
                    <div className="flex gap-2 shrink-0 self-end sm:self-auto">
                    <button onClick={() => edit(r.id)} className="p-2 rounded-xl bg-veil/5 hover:bg-primary/20 text-muted hover:text-primary transition" title="AI edit">
                      <Wand2 size={16} />
                    </button>
                    {r.signedUrl && (
                      <button
                        onClick={() => setPlaying(playing === r.id ? null : r.id)}
                        className="p-2 rounded-xl bg-veil/5 hover:bg-veil/10 text-muted hover:text-text transition"
                        title={playing === r.id ? 'Hide preview' : 'Play'}
                      >
                        {playing === r.id ? <X size={16} /> : <Play size={16} />}
                      </button>
                    )}
                    {/* signedUrl, not file_url.
                        `file_url` holds the public-style URL written at upload
                        time, and the recordings bucket is private — following
                        it returns "Bucket not found". The API signs each ready
                        recording for an hour, and that is the only URL that
                        actually resolves. */}
                    {(r.downloadUrl || r.signedUrl) && (
                      <a
                        href={(r.downloadUrl ?? r.signedUrl) ?? undefined}
                        download
                        className="p-2 rounded-xl bg-veil/5 hover:bg-veil/10 text-muted hover:text-text transition"
                        title="Download"
                      >
                        <Download size={16} />
                      </a>
                    )}
                    <button onClick={() => remove(r.id)} className="p-2 rounded-xl bg-veil/5 hover:bg-danger/20 text-muted hover:text-danger transition" title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>

              {/* The recording itself, played in place.
                  Mounted only while open — one <video> per row would have the
                  browser fetch metadata for every recording on the page, which
                  on a long list is a lot of requests for something nobody has
                  asked to watch yet. */}
              {playing === r.id && r.signedUrl && (
                <div className="mt-4 rounded-2xl overflow-hidden border border-border bg-black">
                  <video
                    src={r.signedUrl}
                    controls
                    autoPlay
                    playsInline
                    preload="metadata"
                    className="w-full aspect-video"
                    // The signed URL expires after an hour. Saying so beats a
                    // silent black rectangle if someone leaves the page open.
                    onError={() => toast.error('This preview link expired. Refresh the page and try again.')}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
