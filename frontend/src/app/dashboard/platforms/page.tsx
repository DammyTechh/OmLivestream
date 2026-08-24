'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Check, X, Plus, KeyRound, AlertTriangle, MessageSquare, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  YouTubeIcon, FacebookIcon, InstagramIcon, TwitchIcon,
  TikTokIcon, XIcon, LinkedInIcon, KickIcon,
} from '@/components/ui/BrandIcons';
import { api, getApiError, unwrap } from '@/lib/api';

/**
 * How a platform is connected, and what that connection can actually do.
 *
 * `connect` is the honest primary action for each one:
 *
 *   'oauth'  Signing in gets us the stream key automatically. No typing.
 *   'key'    We cannot read a key over the platform's API, so the user
 *            pastes one. OAuth would store a token that go-live cannot use.
 *
 * `live` marks the two platforms that expose a readable live session —
 * YouTube's liveBroadcast and Facebook's live video. Those are the only two
 * that can return comments and viewer counts, because they are the only two
 * with a public read for a broadcast we are pushing over RTMP. Saying so on
 * the card is better than a comment feed that stays empty with no
 * explanation.
 */
const PLATFORMS = [
  { id: 'youtube',   label: 'YouTube',   Icon: YouTubeIcon,   color: '#FF0000', connect: 'oauth', live: true,
    rtmp: 'rtmp://a.rtmp.youtube.com/live2',
    help: 'YouTube Studio → Go Live → Stream key' },
  { id: 'facebook',  label: 'Facebook',  Icon: FacebookIcon,  color: '#1877F2', connect: 'oauth', live: true,
    rtmp: 'rtmps://live-api-s.facebook.com:443/rtmp',
    help: 'Facebook Live Producer → Streaming software' },
  { id: 'twitch',    label: 'Twitch',    Icon: TwitchIcon,    color: '#9146FF', connect: 'oauth', live: false,
    rtmp: 'rtmp://live.twitch.tv/live',
    help: 'Twitch Dashboard → Settings → Stream' },
  { id: 'kick',      label: 'Kick',      Icon: KickIcon,      color: '#53FC18', connect: 'key',   live: false,
    rtmp: 'rtmp://ingest.kick.com/live',
    help: 'Kick Settings → Stream Key' },
  { id: 'instagram', label: 'Instagram', Icon: InstagramIcon, color: '#E4405F', connect: 'key',   live: false,
    rtmp: '',
    help: 'Instagram Live Producer — requires a Professional account' },
  // Stream key only, and that is not a temporary state. TikTok for Developers
  // confirmed in writing (Aug 2026) that there is no public TikTok LIVE API:
  // no programmatic way to start a broadcast, and no LIVE chat, viewer or
  // event data. Connecting via OAuth would store a token that go-live cannot
  // use, so the key is the real path rather than a fallback.
  { id: 'tiktok',    label: 'TikTok',    Icon: TikTokIcon,    color: '#EE1D52', connect: 'key',   live: false,
    rtmp: '',
    help: 'TikTok LIVE Studio → Stream key (TikTok has no public LIVE API)' },
  { id: 'twitter',   label: 'X',         Icon: XIcon,         color: '#111111', connect: 'key',   live: false,
    rtmp: '',
    help: 'X Media Studio → Producer — requires a paid tier' },
  { id: 'linkedin',  label: 'LinkedIn',  Icon: LinkedInIcon,  color: '#0A66C2', connect: 'key',   live: false,
    rtmp: '',
    help: 'LinkedIn Live — requires access approval' },
] as const;

interface Connection {
  id: string;
  platform: string;
  status: string;
  platform_username: string | null;
  rtmp_url: string | null;
  /** True when both an RTMP URL and a stream key are stored. */
  ready: boolean;
}

function PlatformsContent() {
  const [conns, setConns]     = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyFor, setKeyFor]   = useState<string | null>(null);
  const [form, setForm]       = useState({ rtmpUrl: '', streamKey: '' });
  const [saving, setSaving]   = useState(false);

  const params = useSearchParams();
  const router = useRouter();

  const fetchConns = useCallback(async () => {
    try {
      const res = await api.get('/platforms');
      setConns(res.data?.data || []);
    } catch (err) {
      toast.error(getApiError(err, 'Could not load your connections'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void fetchConns(); }, [fetchConns]);

  // The OAuth callback redirects back here with the outcome in the query
  // string, since a server-side redirect has no other way to report one.
  // Stripped afterwards so a refresh does not repeat the toast.
  useEffect(() => {
    const connected = params.get('connected');
    const error     = params.get('error');
    const platform  = params.get('platform') ?? '';
    if (!connected && !error) return;

    if (connected) toast.success(`${label(connected)} connected`);
    if (error === 'expired') toast.error('That sign-in took too long — please try again.');
    if (error === 'failed')  toast.error(`${label(platform)} refused the connection. Please try again.`);

    router.replace('/dashboard/platforms');
  }, [params, router]);

  const find = (id: string) => conns.find(c => c.platform === id);

  const connectOAuth = async (platform: string) => {
    try {
      const data = unwrap<{ authUrl: string }>(
        await api.post('/platforms/connect/oauth', { platform })
      );
      window.location.href = data.authUrl;
    } catch (err) { toast.error(getApiError(err)); }
  };

  const openKeyForm = (id: string) => {
    const p = PLATFORMS.find(x => x.id === id)!;
    setForm({ rtmpUrl: find(id)?.rtmp_url || p.rtmp, streamKey: '' });
    setKeyFor(id);
  };

  const saveKey = async () => {
    if (!keyFor) return;
    if (!form.rtmpUrl.trim())   return toast.error('Please enter the RTMP server URL.');
    if (!form.streamKey.trim()) return toast.error('Please enter your stream key.');
    setSaving(true);
    try {
      await api.post('/platforms/connect/manual', {
        platform:  keyFor,
        rtmpUrl:   form.rtmpUrl.trim(),
        streamKey: form.streamKey.trim(),
      });
      toast.success(`${label(keyFor)} ready to stream`);
      setKeyFor(null);
      await fetchConns();
    } catch (err) {
      toast.error(getApiError(err, 'Could not save your stream key'));
    } finally { setSaving(false); }
  };

  const disconnect = async (id: string) => {
    const c = find(id);
    if (!c || !confirm(`Disconnect ${label(id)}? You can reconnect at any time.`)) return;
    try {
      await api.delete(`/platforms/${c.id}`);
      await fetchConns();
      toast.success('Disconnected');
    } catch (err) { toast.error(getApiError(err)); }
  };

  const readyCount = conns.filter(c => c.ready && c.status === 'connected').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Connected Platforms</h1>
        <p className="text-muted mt-1">
          Link your accounts once — then every broadcast goes to all of them at the same time.
          {readyCount > 0 && ` ${readyCount} ready to stream.`}
        </p>
      </div>

      {loading ? (
        <Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {PLATFORMS.map((p) => {
            const conn      = find(p.id);
            const connected = conn?.status === 'connected';
            const ready     = Boolean(conn?.ready);

            return (
              <Card key={p.id} className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                      style={{ background: `${p.color}1a` }}
                    >
                      <p.Icon size={24} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium truncate">{p.label}</div>
                      <div className="text-xs mt-0.5">
                        {ready ? (
                          <span className="text-success inline-flex items-center gap-1">
                            <Check size={12} /> {conn?.platform_username || 'Ready to stream'}
                          </span>
                        ) : connected ? (
                          <span className="text-warning inline-flex items-center gap-1">
                            <AlertTriangle size={12} /> Stream key needed
                          </span>
                        ) : (
                          <span className="text-muted">Not connected</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {connected && (
                    <button
                      onClick={() => disconnect(p.id)}
                      className="text-muted hover:text-danger transition-colors p-1 shrink-0"
                      aria-label={`Disconnect ${p.label}`}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>

                {/* What this connection can do, stated per platform rather
                    than promised globally. */}
                {p.live ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    <span className="inline-flex items-center gap-1.5"><MessageSquare size={12} /> Live comments</span>
                    <span className="inline-flex items-center gap-1.5"><BarChart3 size={12} /> Viewer counts</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Video only — {p.label} has no public read for comments or viewers on a stream we push.
                  </p>
                )}

                {keyFor === p.id ? (
                  <div className="space-y-3 pt-1">
                    <Input
                      label="RTMP server URL"
                      placeholder="rtmp://…"
                      value={form.rtmpUrl}
                      onChange={(e) => setForm({ ...form, rtmpUrl: e.target.value })}
                    />
                    <Input
                      label="Stream key"
                      type="password"
                      placeholder="Paste your stream key"
                      value={form.streamKey}
                      onChange={(e) => setForm({ ...form, streamKey: e.target.value })}
                    />
                    <p className="text-xs text-muted">Find it at: {p.help}</p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={saveKey} loading={saving}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setKeyFor(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {p.connect === 'oauth' && !ready && (
                      <Button size="sm" onClick={() => connectOAuth(p.id)} icon={<Plus size={14} />}>
                        {connected ? `Reconnect ${p.label}` : `Connect ${p.label}`}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant={p.connect === 'key' && !ready ? 'primary' : 'secondary'}
                      onClick={() => openKeyForm(p.id)}
                      icon={<KeyRound size={14} />}
                    >
                      {ready ? 'Replace stream key' : 'Enter stream key'}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function label(id: string): string {
  return PLATFORMS.find(p => p.id === id)?.label ?? id;
}

// useSearchParams opts the route into client-side rendering, and the App
// Router requires a Suspense boundary around it or `next build` fails the
// whole page rather than degrading it.
export default function PlatformsPage() {
  return (
    <Suspense fallback={<Card className="h-40 flex items-center justify-center text-muted">Loading…</Card>}>
      <PlatformsContent />
    </Suspense>
  );
}
