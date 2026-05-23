'use client';
import { useEffect, useState } from 'react';
import { useLiveStreamGuard } from '@/hooks/useLiveStreamGuard';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Radio, Square, Users, MessageSquare, TrendingUp, Send, Eye, Heart } from 'lucide-react';
import toast from 'react-hot-toast';
import { io, Socket } from 'socket.io-client';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, unwrap, getApiError, TOKEN_KEYS } from '@/lib/api';
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
  at: string;
}

interface PlatformMetrics {
  platform: string;
  viewers:      number;
  impressions:  number;
  engagement:   number;
  comments:     number;
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
    const token = localStorage.getItem(TOKEN_KEYS.ACCESS);
    const sock  = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001', { auth: { token } });
    sock.emit('join:stream', { streamId: id });
    sock.on('viewers:update', (data: { count: number; byPlatform?: Record<string, number> }) => {
      setViewers(data.count);
      if (data.byPlatform) {
        setPlatformMetrics((prev) => {
          const next = { ...prev };
          Object.entries(data.byPlatform!).forEach(([p, v]) => {
            next[p] = { ...(next[p] ?? { platform: p, viewers: 0, impressions: 0, engagement: 0, comments: 0 }), viewers: v };
          });
          return next;
        });
      }
    });
    sock.on('comment:new', (c: Comment) => {
      setComments((prev) => [c, ...prev].slice(0, 200));
      setPlatformMetrics((prev) => {
        const next = { ...prev };
        const p = c.platform;
        next[p] = { ...(next[p] ?? { platform: p, viewers: 0, impressions: 0, engagement: 0, comments: 0 }), comments: (next[p]?.comments ?? 0) + 1 };
        return next;
      });
    });
    sock.on('metrics:update', (payload: Record<string, PlatformMetrics>) => {
      setPlatformMetrics((prev) => ({ ...prev, ...payload }));
    });
    setSocket(sock);
    return () => { sock.disconnect(); };
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
        comment_id: replyFor.id,
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

      {/* Per-platform impressions grid */}
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
                      <span className="text-muted flex items-center gap-1.5"><Eye size={12} /> Impressions</span>
                      <span className="font-semibold">{formatNumber(m?.impressions ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted flex items-center gap-1.5"><Heart size={12} /> Engagement</span>
                      <span className="font-semibold">{formatNumber(m?.engagement ?? 0)}</span>
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
