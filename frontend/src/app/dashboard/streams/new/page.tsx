'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiveStreamGuard } from '@/hooks/useLiveStreamGuard';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Camera, CameraOff, Mic, MicOff, Image as ImageIcon, User as UserIcon,
  Radio, Upload, Wifi, WifiOff, Settings2, Sparkles, Monitor,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, unwrap, getApiError } from '@/lib/api';
import {
  YouTubeIcon, FacebookIcon, InstagramIcon, TikTokIcon, TwitchIcon, XIcon, LinkedInIcon, KickIcon,
} from '@/components/ui/BrandIcons';

type SourceMode = 'camera' | 'avatar' | 'image';
type Filter = 'none' | 'grayscale' | 'sepia' | 'cool' | 'warm' | 'vivid';
type NetQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

const PLATFORMS = [
  { id: 'youtube',   label: 'YouTube',   Icon: YouTubeIcon   },
  { id: 'facebook',  label: 'Facebook',  Icon: FacebookIcon  },
  { id: 'instagram', label: 'Instagram', Icon: InstagramIcon },
  { id: 'tiktok',    label: 'TikTok',    Icon: TikTokIcon    },
  { id: 'twitch',    label: 'Twitch',    Icon: TwitchIcon    },
  { id: 'twitter',   label: 'X',         Icon: XIcon         },
  { id: 'linkedin',  label: 'LinkedIn',  Icon: LinkedInIcon  },
  { id: 'kick',      label: 'Kick',      Icon: KickIcon      },
];

const FILTERS: { id: Filter; label: string; css: string }[] = [
  { id: 'none',      label: 'Normal',    css: 'none' },
  { id: 'grayscale', label: 'B&W',       css: 'grayscale(1)' },
  { id: 'sepia',     label: 'Sepia',     css: 'sepia(0.75)' },
  { id: 'cool',      label: 'Cool',      css: 'hue-rotate(180deg) saturate(1.2)' },
  { id: 'warm',      label: 'Warm',      css: 'hue-rotate(-20deg) saturate(1.3) brightness(1.05)' },
  { id: 'vivid',     label: 'Vivid',     css: 'saturate(1.5) contrast(1.1)' },
];

const AVATARS = [
  '🎮', '🎤', '🎨', '🎬', '🎧', '📸', '✨', '🔥',
];

export default function NewStreamPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imgFileRef = useRef<HTMLInputElement>(null);

  // Stream metadata
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Source mode + A/V state
  const [sourceMode, setSourceMode] = useState<SourceMode>('camera');
  const [cameraOn, setCameraOn] = useState(false);
  // Also guard while user is actively previewing camera — accidental refresh = lost work
  useLiveStreamGuard(cameraOn);
  const [micOn, setMicOn] = useState(true);
  const [filter, setFilter] = useState<Filter>('none');
  const [avatar, setAvatar] = useState('🎮');
  const [staticImage, setStaticImage] = useState<string | null>(null);

  // Network
  const [network, setNetwork] = useState<{ mbps: number | null; quality: NetQuality }>({
    mbps: null, quality: 'unknown',
  });

  // Stream keys (per-platform) — when user doesn't want to OAuth
  const [showKeysFor, setShowKeysFor] = useState<string | null>(null);
  const [streamKey, setStreamKey]     = useState({ rtmpUrl: '', streamKey: '' });

  // ─── Camera / Mic management ────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: micOn,
      });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraOn(true);
    } catch (err: any) {
      toast.error(
        err?.name === 'NotAllowedError'
          ? 'Please allow camera access to preview your stream.'
          : 'Could not access your camera — check your device permissions.'
      );
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next; });
  };

  useEffect(() => {
    // Stop camera on unmount
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ─── Network quality estimate (simple heuristic using Network Info API + download test) ──
  useEffect(() => {
    const nav: any = navigator;
    const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
    if (conn?.downlink) {
      const mbps = conn.downlink;
      setNetwork({
        mbps,
        quality: mbps >= 10 ? 'excellent' : mbps >= 5 ? 'good' : mbps >= 2 ? 'fair' : 'poor',
      });
    }
  }, []);

  const recommendedQuality =
    network.quality === 'excellent' ? '1080p @ 60fps · 6 Mbps' :
    network.quality === 'good'      ? '1080p @ 30fps · 4 Mbps' :
    network.quality === 'fair'      ? '720p @ 30fps · 2.5 Mbps' :
    network.quality === 'poor'      ? '480p @ 30fps · 1 Mbps' :
                                      'Checking…';

  // ─── Image upload ─────────────────────────────────────────────
  const handleStaticImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please pick an image file.');
    if (file.size > 5 * 1024 * 1024)     return toast.error('Image must be under 5 MB.');
    const reader = new FileReader();
    reader.onload = () => setStaticImage(reader.result as string);
    reader.readAsDataURL(file);
  };

  // ─── Platform selection ────────────────────────────────────────
  const toggle = (id: string) => {
    setSelected(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
  };

  const saveStreamKey = async () => {
    if (!showKeysFor) return;
    if (!streamKey.rtmpUrl.trim() || !streamKey.streamKey.trim())
      return toast.error('Please enter both the RTMP URL and stream key.');
    try {
      await api.post('/platforms/connect/manual', {
        platform: showKeysFor,
        rtmpUrl:   streamKey.rtmpUrl.trim(),
        streamKey: streamKey.streamKey.trim(),
      });
      toast.success(`${showKeysFor} connected`);
      setShowKeysFor(null);
      setStreamKey({ rtmpUrl: '', streamKey: '' });
    } catch (err) {
      toast.error(getApiError(err, 'Could not save your stream key'));
    }
  };

  // ─── Create stream ─────────────────────────────────────────────
  const createStream = async () => {
    if (!title.trim())          return toast.error('Please give your stream a title.');
    if (selected.length === 0)  return toast.error('Please pick at least one platform.');
    setSaving(true);
    try {
      const data = unwrap<{ id: string }>(await api.post('/streams', {
        title, description, platforms: selected,
      }));
      toast.success('Stream created — going live…');
      router.push(`/dashboard/streams/${data.id}`);
    } catch (err) {
      toast.error(getApiError(err, 'Could not create stream'));
      setSaving(false);
    }
  };

  
  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <Link href="/dashboard/streams" className="inline-flex items-center gap-2 text-sm text-muted hover:text-text">
        <ArrowLeft size={14} /> Back
      </Link>
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Go Live</h1>
        <p className="text-muted mt-1">Preview your camera, apply filters, and go live on multiple platforms.</p>
      </div>

      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        {/* LEFT: Preview + controls */}
        <div className="space-y-4">
          {/* Preview canvas */}
          <Card className="!p-0 relative aspect-video bg-black overflow-hidden">
            {sourceMode === 'camera' && (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{ filter: FILTERS.find(f => f.id === filter)?.css ?? 'none' }}
                className="w-full h-full object-cover"
              />
            )}
            {sourceMode === 'avatar' && (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 via-accent/10 to-primary-deep/20">
                <div className="text-[180px] drop-shadow-[0_0_60px_rgba(168,85,247,0.5)]">{avatar}</div>
              </div>
            )}
            {sourceMode === 'image' && staticImage && (
              <img src={staticImage} alt="Stream image" className="w-full h-full object-cover" />
            )}
            {sourceMode === 'image' && !staticImage && (
              <div className="w-full h-full flex flex-col items-center justify-center text-muted">
                <ImageIcon size={40} className="mb-3" />
                <p className="text-sm">No image uploaded</p>
              </div>
            )}

            {/* Status overlay */}
            <div className="absolute top-4 left-4 flex gap-2">
              {sourceMode === 'camera' && !cameraOn && (
                <div className="px-3 py-1 rounded-full bg-black/70 text-xs text-muted border border-white/10">
                  Camera off
                </div>
              )}
              <div className="px-3 py-1 rounded-full bg-black/70 text-xs text-text border border-white/10 flex items-center gap-2">
                <Monitor size={11} /> Preview
              </div>
            </div>

            {/* Camera controls — overlaid on preview */}
            {sourceMode === 'camera' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                <button
                  onClick={cameraOn ? stopCamera : startCamera}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg ${
                    cameraOn ? 'bg-white/10 hover:bg-white/20 text-text' : 'bg-primary hover:bg-primary/90 text-white'
                  }`}
                  title={cameraOn ? 'Stop camera' : 'Start camera'}
                >
                  {cameraOn ? <CameraOff size={18} /> : <Camera size={18} />}
                </button>
                {cameraOn && (
                  <button
                    onClick={toggleMic}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg ${
                      micOn ? 'bg-white/10 hover:bg-white/20 text-text' : 'bg-danger hover:bg-danger/90 text-white'
                    }`}
                    title={micOn ? 'Mute mic' : 'Unmute mic'}
                  >
                    {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                  </button>
                )}
              </div>
            )}
          </Card>

          {/* Source tabs */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { mode: 'camera' as const, label: 'Camera',  Icon: Camera    },
              { mode: 'avatar' as const, label: 'Avatar',  Icon: UserIcon  },
              { mode: 'image' as const,  label: 'Image',   Icon: ImageIcon },
            ].map((m) => (
              <button
                key={m.mode}
                onClick={() => {
                  setSourceMode(m.mode);
                  if (m.mode !== 'camera' && cameraOn) stopCamera();
                }}
                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition ${
                  sourceMode === m.mode ? 'bg-primary text-white' : 'bg-white/5 text-muted hover:bg-white/10'
                }`}
              >
                <m.Icon size={14} /> {m.label}
              </button>
            ))}
          </div>

          {/* Source-specific settings */}
          {sourceMode === 'camera' && cameraOn && (
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Video filter</h3>
              </div>
              <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                {FILTERS.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium transition ${
                      filter === f.id ? 'bg-primary text-white' : 'bg-white/5 text-muted hover:bg-white/10'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {sourceMode === 'avatar' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">Pick your avatar</h3>
              <div className="grid grid-cols-8 gap-2">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAvatar(a)}
                    className={`aspect-square text-3xl rounded-xl transition ${
                      avatar === a ? 'bg-primary/20 ring-2 ring-primary' : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Card>
          )}

          {sourceMode === 'image' && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">Upload a static image</h3>
              <input
                ref={imgFileRef}
                type="file"
                accept="image/*"
                onChange={handleStaticImage}
                className="hidden"
              />
              <Button onClick={() => imgFileRef.current?.click()} variant="secondary" icon={<Upload size={14} />}>
                {staticImage ? 'Change image' : 'Choose image'}
              </Button>
              <p className="text-xs text-muted mt-2">PNG, JPEG or WebP. Max 5 MB.</p>
            </Card>
          )}

          {/* Network quality */}
          <Card className="p-5">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  network.quality === 'excellent' || network.quality === 'good' ? 'bg-success/15 text-success' :
                  network.quality === 'fair'                                    ? 'bg-warning/15 text-warning' :
                  network.quality === 'poor'                                    ? 'bg-danger/15 text-danger' :
                                                                                  'bg-white/5 text-muted'
                }`}>
                  {network.quality === 'poor' ? <WifiOff size={16} /> : <Wifi size={16} />}
                </div>
                <div>
                  <div className="text-sm font-semibold capitalize">
                    Network: {network.quality === 'unknown' ? 'checking…' : network.quality}
                    {network.mbps && ` · ${network.mbps.toFixed(1)} Mbps`}
                  </div>
                  <div className="text-xs text-muted">Recommended: {recommendedQuality}</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* RIGHT: Stream metadata + platforms */}
        <div className="space-y-4">
          <Card className="space-y-4">
            <Input
              label="Title *"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday night Valorant ranked grind"
            />
            <div>
              <label className="label">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Tell viewers what to expect…"
                className="input resize-none"
              />
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2 mb-4">
              <Radio size={14} className="text-primary" />
              <h3 className="text-sm font-semibold">Broadcast to</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {PLATFORMS.map((p) => (
                <div key={p.id} className="relative">
                  <button
                    onClick={() => toggle(p.id)}
                    className={`w-full p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                      selected.includes(p.id)
                        ? 'border-primary bg-primary/10'
                        : 'border-white/10 bg-white/[0.02] hover:border-white/20'
                    }`}
                  >
                    <p.Icon size={18} />
                    <span className="text-xs font-medium flex-1">{p.label}</span>
                  </button>
                  <button
                    onClick={() => setShowKeysFor(showKeysFor === p.id ? null : p.id)}
                    className="absolute top-2 right-2 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted"
                    title="Enter stream key manually"
                  >
                    <Settings2 size={11} />
                  </button>
                </div>
              ))}
            </div>

            {/* Inline stream key form */}
            {showKeysFor && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="border-t border-border pt-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold capitalize">{showKeysFor} — RTMP key</div>
                  <button onClick={() => setShowKeysFor(null)} className="text-xs text-muted hover:text-text">Cancel</button>
                </div>
                <Input
                  label="RTMP Server URL"
                  value={streamKey.rtmpUrl}
                  onChange={(e) => setStreamKey({ ...streamKey, rtmpUrl: e.target.value })}
                  placeholder="rtmp://a.rtmp.youtube.com/live2"
                />
                <Input
                  label="Stream Key"
                  type="password"
                  value={streamKey.streamKey}
                  onChange={(e) => setStreamKey({ ...streamKey, streamKey: e.target.value })}
                  placeholder="xxxx-xxxx-xxxx-xxxx"
                />
                <Button onClick={saveStreamKey} size="sm" className="w-full">Save key</Button>
                <p className="text-[11px] text-muted">
                  Get your stream key from your {showKeysFor} creator dashboard. This is stored encrypted.
                </p>
              </motion.div>
            )}

            <p className="text-xs text-muted mt-3">
              Free plan: up to 2 platforms. Premium: all 8.
            </p>
          </Card>

          <Button onClick={createStream} loading={saving} icon={<Radio size={16} />} className="w-full">
            Create & Go Live
          </Button>
        </div>
      </div>
    </div>
  );
}
