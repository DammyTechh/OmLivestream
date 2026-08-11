'use client';
import { useEffect, useState } from 'react';
import { useLiveStreamGuard } from '@/hooks/useLiveStreamGuard';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Radio, Square, Users, MessageSquare, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Socket } from 'socket.io-client';
import { acquireSocket, releaseSocket } from '@/lib/socket';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, unwrap, getApiError } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import {
  YouTubeIcon, FacebookIcon, InstagramIcon, TikTokIcon, TwitchIcon,
  XIcon, LinkedInIcon, KickIcon,
} from '@/components/ui/BrandIcons';

const PLATFORM_ICONS: Record<string, React.FC<{ size?: number }>> = {
  youtube:   YouTubeIcon,
  facebook:  FacebookIcon,
  instagram: InstagramIcon,
  tiktok:    TikTokIcon,
  twitch:    TwitchIcon,
  twitter:   XIcon,
  linkedin:  LinkedInIcon,
  kick:      KickIcon,
};

interface StreamDetail {
  id: string;
  title: string;
  description: string | null;
  status: 'scheduled' | 'live' | 'ended';
  stream_platforms?: { platform: string; rtmp_push_status: string }[];
}

interface Comment {
  id: string;
  platform: string;
  author: string;
  text: string;
  timestamp: string;
  /** The platform's own comment id — used as the reply target. */
  platformCommentId: string;
}

/**
 * What we can actually measure per platform during a broadcast.
 *
 * Viewers arrive on 'metrics:update' from the backend's metrics sampler, which
 * reads YouTube's concurrentViewers and Facebook's live_views. Comments are
 * counted from 'comment:new' as they land.
 *
 * Impressions and engagement used to sit alongside these. Nothing produced
 * either — no live API reports impressions, and engagement had no emitter at
 * all — so both rendered a permanent zero next to two real numbers, which is
 * worse than not showing them.
 */
interface PlatformMetrics {
  platform: string;
  viewers:  number;
  comments: number;
}

export default function StreamDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [stream, setStream] = useState<StreamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [viewers, setViewers] = useState(0);
  const [comments, setComments] = useState<Comment[]>([]);
  const [platformMetrics, setPlatformMetrics] = useState<Record<string, PlatformMetrics>>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const [replyFor, setReplyFor] = useState<Comment | null>(null);
  const [replyText, setReplyText] = useState('');
  const [filterPlatform, setFilterPlatform] = useState<string>('all');

  // Prevent accidental refresh / swipe-to-refresh / back-navigation while live
  useLiveStreamGuard(stream?.status === 'live');

  useEffect(() => { fetchStream(); }, [id]);

  useEffect(() => {
    if (!stream || stream.status !== 'live') return;
    const sock = acquireSocket();
    if (!sock) return;
    // A bare id, not { streamId }. The server's handler signature is
    // (streamId: string), so an object arrived as the id, failed the liveness
    // lookup, and the join silently never happened.
    sock.emit('join:stream', id);
    // 'stream:viewers' is what the server actually emits — the old
    // 'viewers:update' listener could never fire, so the count on this page
    // sat at zero for the whole broadcast. It carries the count of connected
    // dashboard sockets; the per-platform audience arrives on 'metrics:update'.
    sock.on('stream:viewers', (data: { count: number }) => setViewers(data.count));
    sock.on('comment:new', (c: Comment) => {
      setComments((prev) => [c, ...prev].slice(0, 200));
      setPlatformMetrics((prev) => {
        const next = { ...prev };
        const p = c.platform;
        next[p] = { ...(next[p] ?? { platform: p, viewers: 0, comments: 0 }), comments: (next[p]?.comments ?? 0) + 1 };
        return next;
      });
    });
    // Concurrent viewers per platform, sampled from the platforms' own APIs
    // every 30s. Merged rather than replaced: a platform missing from a tick
    // was unreadable, not empty, and its comment count lives here too.
    sock.on('metrics:update', (viewersByPlatform: Record<string, number>) => {
      setPlatformMetrics((prev) => {
        const next = { ...prev };
        Object.entries(viewersByPlatform).forEach(([p, v]) => {
          next[p] = { ...(next[p] ?? { platform: p, viewers: 0, comments: 0 }), viewers: v };
        });
        return next;
      });
    });
    setSocket(sock);
    return () => {
      // Leave the room explicitly. The server decrements on disconnect too,
      // but the connection is shared now and outlives this page.
      sock.emit('leave:stream', id);
      sock.off('stream:viewers');
      sock.off('comment:new');
      sock.off('metrics:update');
      releaseSocket();
    };
  }, [stream?.status, id]);

  async function fetchStream() {
    try {
      const data = unwrap<StreamDetail>(await api.get(`/streams/${id}`));
      setStream(data);
    } catch {
      toast.error('Stream not found');
      router.replace('/dashboard/streams');
    } finally { setLoading(false); }
  }

  async function startStream() {
    setActioning(true);
    try {
      await api.post(`/streams/${id}/start`);
      toast.success('Stream started — you are LIVE');
      await fetchStream();
    } catch (err) {
      toast.error(getApiError(err, 'Could not start stream'));
    } finally { setActioning(false); }
  }

  async function endStream() {
    if (!confirm('End this stream? The recording will start processing.')) return;
    setActioning(true);
    try {
      await api.post(`/streams/${id}/end`);
      toast.success('Stream ended — recording is processing');
      await fetchStream();
    } catch (err) {
      toast.error(getApiError(err, 'Could not end stream'));
    } finally { setActioning(false); }
  }

  const sendReply = async () => {
    if (!replyFor || !replyText.trim()) return;
    try {
      await api.post(`/streams/${id}/comments/reply`, {
        platform:   replyFor.platform,
        commentId:  replyFor.platformCommentId,
        text:       replyText,
      });
      toast.success(`Reply sent to ${replyFor.platform}`);
      setReplyText('');
      setReplyFor(null);
    } catch (err) {
      toast.error(getApiError(err, 'Could not send reply'));
    }
  };

  if (loading) return <Card className="h-60 flex items-center justify-center text-muted">Loading stream…</Card>;
  if (!stream) return null;

  const filteredComments = filterPlatform === 'all' ? comments : comments.filter(c => c.platform === filterPlatform);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <Link href="/dashboard/streams" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} /> Back to streams
      </Link>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
              stream.status === 'live'      ? 'bg-danger/20 text-danger' :
              stream.status === 'scheduled' ? 'bg-primary/20 text-primary' :
              'bg-white/10 text-muted'
            }`}>
              {stream.status === 'live' && <span className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />}
              {stream.status.toUpperCase()}
            </span>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tight">{stream.title}</h1>
          {stream.description && <p className="text-muted mt-1">{stream.description}</p>}
        </div>
        <div className="flex gap-3">
          {stream.status === 'scheduled' && (
            <Button onClick={startStream} loading={actioning} icon={<Radio size={16} />}>Go Live</Button>
          )}
          {stream.status === 'live' && (
            <Button variant="danger" onClick={endStream} loading={actioning} icon={<Square size={16} />}>End Stream</Button>
          )}
        </div>
      </div>

      {/* Per-platform live audience and comments */}
      {stream.status === 'live' && (
        <div>
          <h2 className="font-display text-xl font-semibold mb-3">Live stats by platform</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(stream.stream_platforms ?? []).map((p) => {
              const Icon = PLATFORM_ICONS[p.platform];
              const m = platformMetrics[p.platform];
              return (
                <Card key={p.platform} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    {Icon && <Icon size={16} />}
                    <span className="text-xs uppercase tracking-widest text-muted capitalize">{p.platform}</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted flex items-center gap-1.5"><Users size={12} /> Viewers</span>
                      <span className="font-semibold">{formatNumber(m?.viewers ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted flex items-center gap-1.5"><MessageSquare size={12} /> Comments</span>
                      <span className="font-semibold">{formatNumber(m?.comments ?? 0)}</span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Platforms status row */}
      <div>
        <h2 className="font-display text-xl font-semibold mb-3">Broadcasting status</h2>
        <div className="flex flex-wrap gap-2">
          {stream.stream_platforms?.map((p) => {
            const Icon = PLATFORM_ICONS[p.platform];
            return (
              <div key={p.platform} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10">
                <div className={`w-2 h-2 rounded-full ${p.rtmp_push_status === 'active' ? 'bg-success animate-pulse' : 'bg-muted'}`} />
                {Icon && <Icon size={14} />}
                <span className="text-sm capitalize">{p.platform}</span>
                <span className="text-xs text-muted capitalize">· {p.rtmp_push_status}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Unified comments feed */}
      {stream.status === 'live' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-xl font-semibold">Unified comments</h2>
            <div className="flex gap-2">
              <button
                onClick={() => setFilterPlatform('all')}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  filterPlatform === 'all' ? 'bg-primary text-white' : 'bg-white/5 text-muted hover:bg-white/10'
                }`}
              >
                All ({comments.length})
              </button>
              {(stream.stream_platforms ?? []).map((p) => (
                <button
                  key={p.platform}
                  onClick={() => setFilterPlatform(p.platform)}
                  className={`px-3 py-1 rounded-full text-xs font-medium capitalize transition ${
                    filterPlatform === p.platform ? 'bg-primary text-white' : 'bg-white/5 text-muted hover:bg-white/10'
                  }`}
                >
                  {p.platform}
                </button>
              ))}
            </div>
          </div>

          <Card className="h-[30rem] overflow-y-auto">
            {filteredComments.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted">Waiting for comments…</div>
            ) : (
              <div className="space-y-2">
                {filteredComments.map((c) => {
                  const Icon = PLATFORM_ICONS[c.platform];
                  return (
                    <div key={c.id} className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/5 transition">
                      {Icon ? <Icon size={14} /> : <div className="w-3.5 h-3.5 rounded-full bg-primary mt-1" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="font-medium text-sm">{c.author}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-muted capitalize">{c.platform}</span>
                        </div>
                        <p className="text-sm text-muted">{c.text}</p>
                        {replyFor?.id === c.id ? (
                          <div className="mt-2 flex gap-2">
                            <input
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder={`Reply to ${c.author} on ${c.platform}…`}
                              className="input text-sm py-2"
                              autoFocus
                            />
                            <Button size="sm" onClick={sendReply} icon={<Send size={12} />}>Send</Button>
                            <button onClick={() => { setReplyFor(null); setReplyText(''); }} className="text-xs text-muted hover:text-text px-2">Cancel</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setReplyFor(c); setReplyText(''); }}
                            className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                          >
                            <Send size={11} /> Reply
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
