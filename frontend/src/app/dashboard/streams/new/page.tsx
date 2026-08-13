'use client';
import { useEffect, useRef, useState } from 'react';
import { useLiveStreamGuard } from '@/hooks/useLiveStreamGuard';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  ArrowLeft, Camera, CameraOff, Mic, MicOff, Image as ImageIcon, User as UserIcon,
  Radio, Upload, Wifi, WifiOff, Settings2, Sparkles, Monitor,
  Gauge, RefreshCw, AlertTriangle, CheckCircle2, Activity,
  Gamepad2, Palette, Clapperboard, Headphones, Music, Flame, Presentation,
  SwitchCamera, PictureInPicture2, Repeat2, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { api, unwrap, getApiError } from '@/lib/api';
import {
  YouTubeIcon, FacebookIcon, InstagramIcon, TikTokIcon, TwitchIcon, XIcon, LinkedInIcon, KickIcon,
} from '@/components/ui/BrandIcons';
import { measureNetwork, type Progress, type RawMeasurement } from '@/lib/network-test';
import { useMultiCam, type CamSource } from '@/hooks/useMultiCam';
import { VirtualCameraTip } from '@/components/dashboard/VirtualCameraTip';

type SourceMode = 'camera' | 'avatar' | 'image';
type Filter = 'none' | 'grayscale' | 'sepia' | 'cool' | 'warm' | 'vivid';

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

/**
 * Avatar options for creators who stream without a camera.
 *
 * These were emoji. Emoji render differently on every platform — the same
 * stream looked like a different brand on Windows, macOS and Android — and
 * they read as unfinished. Line icons render identically everywhere and
 * inherit the theme colour.
 */
const AVATARS = [
  { id: 'gaming',   label: 'Gaming',   Icon: Gamepad2     },
  { id: 'music',    label: 'Music',    Icon: Music        },
  { id: 'art',      label: 'Art',      Icon: Palette      },
  { id: 'film',     label: 'Film',     Icon: Clapperboard },
  { id: 'podcast',  label: 'Podcast',  Icon: Headphones   },
  { id: 'photo',    label: 'Photo',    Icon: ImageIcon    },
  { id: 'talk',     label: 'Talk',     Icon: Presentation },
  { id: 'trending', label: 'Trending', Icon: Flame        },
];

/** Mirrors NetworkTestResult from the backend's network.service. */
interface NetworkAnalysis {
  uploadMbps:        number;
  latencyMs:         number;
  jitterMs:          number;
  packetLossPercent: number;
  recommended: {
    tier:             string;
    resolution:       string;
    frameRate:        number;
    videoBitrateKbps: number;
    audioBitrateKbps: number;
    label:            string;
    description:      string;
  };
  platformSupport: { platform: string; supported: boolean; maxQuality: string; note?: string }[];
  statusColor:     'green' | 'yellow' | 'orange' | 'red';
  statusMessage:   string;
  tips:            string[];
  canStream:       boolean;
  adaptiveEnabled: boolean;
}

/** Maps the backend's status colour onto theme tokens. */
const STATUS_STYLES: Record<NetworkAnalysis['statusColor'], { chip: string; dot: string; text: string }> = {
  green:  { chip: 'bg-success/15 text-success', dot: 'bg-success', text: 'text-success' },
  yellow: { chip: 'bg-warning/15 text-warning', dot: 'bg-warning', text: 'text-warning' },
  orange: { chip: 'bg-warning/15 text-warning', dot: 'bg-warning', text: 'text-warning' },
  red:    { chip: 'bg-danger/15 text-danger',   dot: 'bg-danger',  text: 'text-danger'  },
};

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

  /**
   * Camera capture — one camera, or front and back together as
   * picture-in-picture. The hook owns the tracks and hands back a single
   * composited stream, so everything below this line sees one video source
   * regardless of how many cameras are actually open.
   */
  const cam = useMultiCam({ audio: true });
  const cameraOn = cam.running;
  const [dualBusy, setDualBusy] = useState(false);
  const [showCamTip, setShowCamTip] = useState(true);

  // Also guard while user is actively previewing camera — accidental refresh = lost work
  useLiveStreamGuard(cameraOn);
  const [micOn, setMicOn] = useState(true);
  const [filter, setFilter] = useState<Filter>('none');
  const [avatar, setAvatar] = useState('gaming');
  const [staticImage, setStaticImage] = useState<string | null>(null);

  // Network pre-flight
  const [netRunning,  setNetRunning]  = useState(false);
  const [netProgress, setNetProgress] = useState<Progress | null>(null);
  const [netResult,   setNetResult]   = useState<NetworkAnalysis | null>(null);
  const [netError,    setNetError]    = useState<string | null>(null);

  // Stream keys (per-platform) — when user doesn't want to OAuth
  const [showKeysFor, setShowKeysFor] = useState<string | null>(null);
  const [streamKey, setStreamKey]     = useState({ rtmpUrl: '', streamKey: '' });

  // ─── Camera / Mic management ────────────────────────────────────
  // The hook owns capture and cleanup; these are thin wrappers that keep the
  // existing UI contract (start / stop / mute) and surface errors as toasts.
  const startCamera = async () => {
    const ok = await cam.start();
    if (!ok && cam.error) return toast.error(cam.error);
    // The hook always captures audio so the mic can be unmuted later without
    // re-prompting; honour the creator's current toggle straight away.
    cam.setMicEnabled(micOn);
  };

  const stopCamera = () => {
    cam.stop();
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    cam.setMicEnabled(next);
  };

  /** Point the big picture at the other camera (front ⇆ back, or next device). */
  const flipCamera = async () => {
    let target: CamSource;
    if (cam.primarySource.kind === 'facing') {
      target = { kind: 'facing', facing: cam.primarySource.facing === 'user' ? 'environment' : 'user' };
    } else {
      const list = cam.devices;
      const i = list.findIndex((d) => d.deviceId === (cam.primarySource as { deviceId: string }).deviceId);
      const nextDev = list[(i + 1) % Math.max(list.length, 1)];
      if (!nextDev) return;
      target = { kind: 'device', deviceId: nextDev.deviceId };
    }
    const ok = await cam.switchPrimary(target);
    if (!ok && cam.error) toast.error(cam.error);
  };

  /** Turn the second camera on or off. Failure keeps the first camera running. */
  const toggleDual = async () => {
    if (dualBusy) return;
    setDualBusy(true);
    try {
      if (cam.layout === 'pip') {
        cam.disableDual();
      } else {
        const ok = await cam.enableDual();
        if (!ok) toast.error(cam.dualError ?? 'Couldn\'t start the second camera.');
        else toast.success('Both cameras are live.');
      }
    } finally {
      setDualBusy(false);
    }
  };

  // Keep the preview element pointed at whatever the hook is currently
  // producing — the raw camera in single mode, the composited canvas in dual.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = cam.outputStream;
    streamRef.current = cam.outputStream;
  }, [cam.outputStream]);

  // Leaving camera mode should release the hardware rather than leave the
  // capture light on behind an avatar or a static image.
  useEffect(() => {
    if (sourceMode !== 'camera' && cam.running) cam.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMode]);

  // ─── Network pre-flight check ──────────────────────────────────
  /**
   * Runs a real measurement, then asks the backend which quality tier
   * that connection can actually sustain.
   *
   * This replaces a read of `navigator.connection.downlink`, which was
   * wrong in three separate ways: it is a *download* estimate (streaming is
   * bound by upload), it is a coarse rounded guess rather than a
   * measurement, and it does not exist at all in Safari or Firefox — where
   * the old code silently left the user on "checking…" forever.
   *
   * Not run on mount: it moves real data and takes a few seconds, so it is
   * user-initiated, and re-runnable when they change networks.
   */
  const runNetworkCheck = async () => {
    if (netRunning) return;
    setNetRunning(true);
    setNetError(null);
    setNetResult(null);

    try {
      const raw: RawMeasurement = await measureNetwork(selected, setNetProgress);
      const analysis = unwrap<NetworkAnalysis>(
        await api.post('/streams/network-check', {
          ...raw,
          selectedPlatforms: selected,
        })
      );
      setNetResult(analysis);
    } catch (err) {
      setNetError(getApiError(err, 'Could not measure your connection. Please try again.'));
    } finally {
      setNetRunning(false);
      setNetProgress(null);
    }
  };

  // A result measured against three platforms is not valid for six. Rather
  // than show a stale recommendation, clear it and let the user re-run.
  const platformKey = selected.join(',');
  useEffect(() => {
    setNetResult(null);
  }, [platformKey]);

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
                {(() => {
                  const A = AVATARS.find((a) => a.id === avatar) ?? AVATARS[0];
                  return (
                    <A.Icon
                      size={140}
                      strokeWidth={1.25}
                      className="text-white drop-shadow-[0_0_60px_rgba(168,85,247,0.5)]"
                    />
                  );
                })()}
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

            {/* Status overlay.

                These pills sit on the video preview, which is black in both
                themes. So they keep literal white text and a white hairline
                rather than the theme tokens — `text-muted` would resolve to a
                near-black on light and vanish against the footage. */}
            <div className="absolute top-4 left-4 flex gap-2">
              {sourceMode === 'camera' && !cameraOn && (
                <div className="px-3 py-1 rounded-full bg-black/70 text-xs text-white/70 border border-white/10">
                  Camera off
                </div>
              )}
              <div className="px-3 py-1 rounded-full bg-black/70 text-xs text-white border border-white/10 flex items-center gap-2">
                <Monitor size={11} /> Preview
              </div>
              {sourceMode === 'camera' && cameraOn && cam.layout === 'pip' && (
                <div className="px-3 py-1 rounded-full bg-primary/80 text-xs text-white border border-white/20 flex items-center gap-2">
                  <PictureInPicture2 size={11} /> Both cameras
                </div>
              )}
            </div>

            {/* Camera controls — overlaid on preview */}
            {sourceMode === 'camera' && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                <button
                  onClick={cameraOn ? stopCamera : startCamera}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg ${
                    cameraOn ? 'bg-veil/10 hover:bg-veil/20 text-text' : 'bg-primary hover:bg-primary/90 text-white'
                  }`}
                  title={cameraOn ? 'Stop camera' : 'Start camera'}
                >
                  {cameraOn ? <CameraOff size={18} /> : <Camera size={18} />}
                </button>
                {cameraOn && (
                  <button
                    onClick={toggleMic}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg ${
                      micOn ? 'bg-veil/10 hover:bg-veil/20 text-text' : 'bg-danger hover:bg-danger/90 text-white'
                    }`}
                    title={micOn ? 'Mute mic' : 'Unmute mic'}
                  >
                    {micOn ? <Mic size={18} /> : <MicOff size={18} />}
                  </button>
                )}
                {cameraOn && (
                  <button
                    onClick={flipCamera}
                    className="w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg bg-veil/10 hover:bg-veil/20 text-text"
                    title="Switch camera"
                  >
                    <SwitchCamera size={18} />
                  </button>
                )}
                {cameraOn && cam.profile.isDesktop && (
                  <button
                    onClick={toggleDual}
                    disabled={dualBusy}
                    className={`w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg disabled:opacity-60 ${
                      cam.layout === 'pip'
                        ? 'bg-primary hover:bg-primary/90 text-white'
                        : 'bg-veil/10 hover:bg-veil/20 text-text'
                    }`}
                    title={cam.layout === 'pip' ? 'Use one camera' : 'Use both cameras'}
                  >
                    <PictureInPicture2 size={18} />
                  </button>
                )}
                {cameraOn && cam.profile.isDesktop && cam.layout === 'pip' && (
                  <button
                    onClick={() => cam.swap()}
                    className="w-12 h-12 rounded-full flex items-center justify-center transition shadow-lg bg-veil/10 hover:bg-veil/20 text-text"
                    title="Swap which camera is large"
                  >
                    <Repeat2 size={18} />
                  </button>
                )}
              </div>
            )}

            {/* Corner picker — only meaningful while two cameras are running. */}
            {sourceMode === 'camera' && cameraOn && cam.layout === 'pip' && (
              <div className="absolute top-4 right-4 flex flex-col gap-1.5">
                <div className="text-[10px] text-white/60 text-right pr-0.5">Inset</div>
                <div className="grid grid-cols-2 gap-1">
                  {(['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => cam.setPipCorner(c)}
                      aria-label={`Move inset to ${c.replace('-', ' ')}`}
                      className={`w-5 h-5 rounded-md border transition ${
                        cam.pipCorner === c
                          ? 'bg-primary border-primary'
                          : 'bg-black/50 border-white/25 hover:border-white/60'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Source tabs */}
          <div className={`grid gap-2 ${cam.profile.isDesktop ? 'grid-cols-3' : 'grid-cols-2'}`}>
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
                  sourceMode === m.mode ? 'bg-primary text-white' : 'bg-veil/5 text-muted hover:bg-veil/10'
                }`}
              >
                <m.Icon size={14} /> {m.label}
              </button>
            ))}
          </div>

          {/* ── Camera setup ──────────────────────────────────────────
              Which camera fills the frame, and whether a second one runs
              alongside it. Only meaningful in camera mode. */}
          {sourceMode === 'camera' && (
            <Card className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <SwitchCamera size={14} className="text-primary" />
                <h3 className="text-sm font-semibold">Camera setup</h3>
              </div>

              {/* Layout choice */}
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: 'front', label: 'Front only',  hint: 'Selfie camera' },
                  { id: 'back',  label: 'Back only',   hint: 'Rear camera'   },
                  // Two simultaneous cameras is a desktop feature. On phones it
                  // is unavailable on iOS outright and unreliable on Android,
                  // and a picture-in-picture inset on a handset-sized frame is
                  // cramped even where the hardware allows it — so rather than
                  // offer a control that mostly fails, the option is simply not
                  // there on mobile. Flip / front / back all still work.
                  ...(cam.profile.isDesktop
                    ? [{ id: 'both' as const, label: 'Both', hint: 'Picture-in-picture' }]
                    : []),
                ] as const).map((opt) => {
                  const activeFacing = cam.primarySource.kind === 'facing' ? cam.primarySource.facing : null;
                  const isActive =
                    opt.id === 'both' ? cam.layout === 'pip'
                      : cam.layout === 'single' && (
                          opt.id === 'front' ? activeFacing === 'user' : activeFacing === 'environment'
                        );
                  return (
                    <button
                      key={opt.id}
                      disabled={dualBusy}
                      onClick={async () => {
                        if (opt.id === 'both') {
                          if (cam.layout === 'pip') return;
                          if (!cam.running) {
                            const ok = await cam.start();
                            if (!ok) return toast.error(cam.error ?? 'Could not access your camera.');
                          }
                          return toggleDual();
                        }
                        if (cam.layout === 'pip') cam.disableDual();
                        const facing = opt.id === 'front' ? 'user' as const : 'environment' as const;
                        if (!cam.running) {
                          const ok = await cam.start({ kind: 'facing', facing });
                          if (!ok) toast.error(cam.error ?? 'Could not access your camera.');
                          return;
                        }
                        const ok = await cam.switchPrimary({ kind: 'facing', facing });
                        if (!ok) toast.error(cam.error ?? 'Could not switch camera.');
                      }}
                      className={`px-3 py-2.5 rounded-xl text-left transition disabled:opacity-60 ${
                        isActive ? 'bg-primary text-white' : 'bg-veil/5 hover:bg-veil/10 text-text'
                      }`}
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className={`text-[10px] mt-0.5 ${isActive ? 'text-white/70' : 'text-muted'}`}>
                        {opt.hint}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Named device pickers — computers usually have several cameras,
                  and the labels only exist once permission has been granted. */}
              {cam.devices.length > 1 && cam.devices.some((d) => d.deviceId) && (
                <div className="space-y-2">
                  <label className="text-xs text-muted">Main camera</label>
                  <select
                    value={cam.primarySource.kind === 'device' ? cam.primarySource.deviceId : ''}
                    onChange={async (e) => {
                      const id = e.target.value;
                      if (!id) return;
                      const ok = cam.running
                        ? await cam.switchPrimary({ kind: 'device', deviceId: id })
                        : await cam.start({ kind: 'device', deviceId: id });
                      if (!ok) toast.error(cam.error ?? 'Could not switch camera.');
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-veil/[0.04] border border-veil/10 text-sm focus:border-primary/60 focus:outline-none"
                  >
                    <option value="">
                      {cam.primarySource.kind === 'facing'
                        ? `Automatic (${cam.primarySource.facing === 'user' ? 'front' : 'back'})`
                        : 'Select a camera'}
                    </option>
                    {cam.devices.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                    ))}
                  </select>

                  {cam.layout === 'pip' && (
                    <>
                      <label className="text-xs text-muted">Inset camera</label>
                      <select
                        value={cam.secondarySource?.kind === 'device' ? cam.secondarySource.deviceId : ''}
                        onChange={async (e) => {
                          const id = e.target.value;
                          if (!id) return;
                          const ok = await cam.enableDual({ kind: 'device', deviceId: id });
                          if (!ok) toast.error(cam.dualError ?? 'Could not switch the inset camera.');
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-veil/[0.04] border border-veil/10 text-sm focus:border-primary/60 focus:outline-none"
                      >
                        <option value="">Automatic</option>
                        {cam.devices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                        ))}
                      </select>
                    </>
                  )}
                </div>
              )}

              {/* Honest capability note — set before they try, not after it fails. */}
              {cam.profile.isDesktop && cam.layout !== 'pip' && cam.profile.dualCameraNote && (
                <div className="flex items-start gap-2 text-[11px] text-muted leading-relaxed">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  <span>{cam.profile.dualCameraNote}</span>
                </div>
              )}

              {cam.dualError && (
                <div className="flex items-start gap-2 text-[11px] text-warning leading-relaxed">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{cam.dualError}</span>
                </div>
              )}

              {/* Desktop only: virtual camera software lifts the ceiling past
                  the two cameras a browser can open on its own. */}
              {cam.profile.isDesktop && showCamTip && (
                <VirtualCameraTip onDismiss={() => setShowCamTip(false)} />
              )}
            </Card>
          )}

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
                      filter === f.id ? 'bg-primary text-white' : 'bg-veil/5 text-muted hover:bg-veil/10'
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
              <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
                {AVATARS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAvatar(a.id)}
                    title={a.label}
                    aria-label={a.label}
                    aria-pressed={avatar === a.id}
                    className={`aspect-square rounded-xl transition flex flex-col items-center justify-center gap-1 ${
                      avatar === a.id
                        ? 'bg-primary/20 ring-2 ring-primary text-text'
                        : 'bg-veil/5 hover:bg-veil/10 text-muted hover:text-text'
                    }`}
                  >
                    <a.Icon size={20} strokeWidth={1.5} />
                    <span className="text-[10px] font-medium">{a.label}</span>
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

          {/* Network pre-flight check */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                  netResult ? STATUS_STYLES[netResult.statusColor].chip
                            : netError ? 'bg-danger/15 text-danger'
                                       : 'bg-veil/5 text-muted'
                }`}>
                  {netError            ? <WifiOff size={16} />
                   : netRunning        ? <Activity size={16} className="animate-pulse" />
                   : netResult         ? <Wifi size={16} />
                                       : <Gauge size={16} />}
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Connection check</h3>
                  <p className="text-xs text-muted">
                    {netRunning ? (netProgress?.note ?? 'Measuring…')
                     : netError  ? netError
                     : netResult ? netResult.statusMessage
                                 : 'Measure your real upload speed before going live.'}
                  </p>
                </div>
              </div>

              <Button
                onClick={runNetworkCheck}
                loading={netRunning}
                variant="secondary"
                size="sm"
                icon={netResult || netError ? <RefreshCw size={13} /> : <Gauge size={13} />}
                className="shrink-0"
              >
                {netRunning ? 'Testing' : netResult || netError ? 'Re-test' : 'Test now'}
              </Button>
            </div>

            {/* Progress bar — the test moves real data and takes a few
                seconds, so silence here reads as a hang. */}
            {netRunning && (
              <div className="mt-4">
                <div className="h-1.5 rounded-full bg-veil/5 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary"
                    animate={{ width: `${netProgress?.percent ?? 0}%` }}
                    transition={{ ease: 'easeOut', duration: 0.3 }}
                  />
                </div>
              </div>
            )}

            {netResult && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-5 space-y-4"
              >
                {/* Measured values */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Upload',  value: `${netResult.uploadMbps.toFixed(1)}`, unit: 'Mbps' },
                    { label: 'Latency', value: `${netResult.latencyMs}`,             unit: 'ms'   },
                    { label: 'Jitter',  value: `${netResult.jitterMs}`,              unit: 'ms'   },
                    { label: 'Loss',    value: `${netResult.packetLossPercent}`,     unit: '%'    },
                  ].map((m) => (
                    <div key={m.label} className="rounded-xl bg-veil/[0.03] border border-veil/5 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-muted">{m.label}</div>
                      <div className="text-sm font-semibold tabular-nums">
                        {m.value}<span className="text-muted font-normal text-xs ml-0.5">{m.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Recommended tier */}
                <div className="rounded-xl border border-border bg-primary/[0.06] px-4 py-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-primary shrink-0" />
                    <span className="text-sm font-semibold">{netResult.recommended.label}</span>
                    <span className="text-xs text-muted tabular-nums">
                      · {netResult.recommended.videoBitrateKbps > 0
                          ? `${(netResult.recommended.videoBitrateKbps / 1000).toFixed(1)} Mbps video`
                          : 'audio only'}
                    </span>
                  </div>
                  <p className="text-xs text-muted mt-1.5">{netResult.recommended.description}</p>
                </div>

                {/* Per-platform ceilings — only where a platform caps below
                    what the connection could otherwise carry. */}
                {netResult.platformSupport.some((p) => p.note) && (
                  <div className="space-y-1.5">
                    {netResult.platformSupport.filter((p) => p.note).map((p) => (
                      <div key={p.platform} className="flex items-start gap-2 text-xs text-muted">
                        <AlertTriangle size={12} className="text-warning shrink-0 mt-0.5" />
                        <span className="capitalize">{p.note}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Actionable tips */}
                {netResult.tips.length > 0 && (
                  <div className="space-y-1.5">
                    {netResult.tips.map((tip) => (
                      <div key={tip} className="flex items-start gap-2 text-xs text-muted">
                        <span className={`w-1 h-1 rounded-full shrink-0 mt-1.5 ${STATUS_STYLES[netResult.statusColor].dot}`} />
                        <span>{tip}</span>
                      </div>
                    ))}
                  </div>
                )}

                {netResult.adaptiveEnabled && (
                  <p className="text-[11px] text-muted border-t border-border pt-3">
                    Adaptive quality is on. If your connection dips mid-stream, we lower the
                    bitrate automatically rather than dropping the broadcast.
                  </p>
                )}
              </motion.div>
            )}
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
                        : 'border-veil/10 bg-veil/[0.02] hover:border-veil/20'
                    }`}
                  >
                    <p.Icon size={18} />
                    <span className="text-xs font-medium flex-1">{p.label}</span>
                  </button>
                  <button
                    onClick={() => setShowKeysFor(showKeysFor === p.id ? null : p.id)}
                    className="absolute top-2 right-2 p-1 rounded-lg bg-veil/5 hover:bg-veil/10 text-muted"
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
