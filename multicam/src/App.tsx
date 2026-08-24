import React, { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Mixer, LAYOUTS, DEFAULT_CONFIG, type Source, type LayoutId, type MixerConfig } from './lib/mixer';

/**
 * MultiCam.
 *
 * Laid out the way a vision desk is, because that is what it replaces:
 * sources down the left, the programme output large in the middle, and the
 * controls that change what goes out on the right. An operator glancing up
 * mid-service needs the programme to be the biggest thing on the screen and
 * the "stop" to be somewhere their hand already knows.
 */

const RESOLUTIONS = [
  { label: '1080p', width: 1920, height: 1080, bitrate: 4500 },
  { label: '720p',  width: 1280, height: 720,  bitrate: 2500 },
  { label: '480p',  width: 854,  height: 480,  bitrate: 1200 },
];

interface DeviceOption { deviceId: string; label: string }

export default function App() {
  const mixerRef = useRef<Mixer | null>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  const [cfg, setCfg] = useState<MixerConfig>(DEFAULT_CONFIG);
  const [sources, setSources] = useState<Source[]>([]);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [live, setLive] = useState(false);
  const [fps, setFps] = useState(0);
  const [ffmpegOk, setFfmpegOk] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rtmpUrl, setRtmpUrl] = useState('rtmp://a.rtmp.youtube.com/live2');
  const [streamKey, setStreamKey] = useState('');
  const [res, setRes] = useState(RESOLUTIONS[0]);

  // ── Boot ──────────────────────────────────────────────────────────
  useEffect(() => {
    const m = new Mixer(DEFAULT_CONFIG);
    mixerRef.current = m;
    m.start();

    invoke<string>('check_ffmpeg')
      .then(setFfmpegOk)
      .catch((e) => setError(String(e)));

    void refreshDevices();

    // Mirror the mixer canvas into the visible preview. Drawing the mixer's
    // own canvas into a smaller one costs a single GPU blit and keeps the
    // programme at full resolution regardless of window size.
    const draw = () => {
      const c = previewRef.current;
      const mx = mixerRef.current;
      if (c && mx) {
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.drawImage(mx.canvas, 0, 0, c.width, c.height);
        }
        setFps(mx.fps);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      m.stop();
      m.getSources().forEach((s) => m.removeSource(s.id));
    };
  }, []);

  // Device labels are blank until permission has been granted once, so this
  // gets called again after the first camera is added.
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setCameras(
        all.filter((d) => d.kind === 'videoinput')
           .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })),
      );
    } catch { /* enumeration is best-effort */ }
  }, []);

  const sync = () => {
    const m = mixerRef.current;
    if (!m) return;
    setSources([...m.getSources()]);
    setCfg(m.getConfig());
  };

  // ── Sources ───────────────────────────────────────────────────────
  const addCamera = async (deviceId?: string) => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false, // audio is routed separately; see the note in mixer.ts
      });
      const id = `cam-${Date.now()}`;
      const label = stream.getVideoTracks()[0]?.label || 'Camera';
      await mixerRef.current?.addSource({ id, label, kind: 'camera', stream, enabled: true });
      assignToFirstFreeSlot(id);
      await refreshDevices();
      sync();
    } catch (e) {
      setError(
        (e as Error).name === 'NotReadableError'
          ? 'That camera is already in use by another application.'
          : 'Could not open that camera. Check it is connected and permitted.',
      );
    }
  };

  const addScreen = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      const id = `screen-${Date.now()}`;
      await mixerRef.current?.addSource({ id, label: 'Screen share', kind: 'screen', stream, enabled: true });
      assignToFirstFreeSlot(id);
      // The OS "stop sharing" bar bypasses our UI entirely, so listen for the
      // track ending rather than leaving a dead black panel on screen.
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        mixerRef.current?.removeSource(id);
        sync();
      });
      sync();
    } catch { /* the picker was dismissed — not an error */ }
  };

  const assignToFirstFreeSlot = (id: string) => {
    const m = mixerRef.current;
    if (!m) return;
    const c = m.getConfig();
    const needed = LAYOUTS.find((l) => l.id === c.layout)?.slots ?? 1;
    const slots = [...c.slots];
    for (let i = 0; i < needed; i++) {
      if (!slots[i]) { slots[i] = id; m.setConfig({ slots }); return; }
    }
    slots[0] = id;
    m.setConfig({ slots });
  };

  const setSlot = (index: number, sourceId: string) => {
    const m = mixerRef.current;
    if (!m) return;
    const slots = [...m.getConfig().slots];
    slots[index] = sourceId;
    m.setConfig({ slots });
    sync();
  };

  const changeLayout = (layout: LayoutId) => {
    mixerRef.current?.setConfig({ layout });
    sync();
  };

  // ── Broadcast ─────────────────────────────────────────────────────
  const pumpRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goLive = async () => {
    const m = mixerRef.current;
    if (!m || !streamKey.trim()) return;
    setError(null);
    try {
      m.setConfig({ width: res.width, height: res.height });
      await invoke('start_broadcast', {
        config: {
          rtmp_url: rtmpUrl.trim(),
          stream_key: streamKey.trim(),
          width: res.width,
          height: res.height,
          fps: cfg.fps,
          video_bitrate_kbps: res.bitrate,
          audio_bitrate_kbps: 160,
        },
      });
      setLive(true);

      // Feed the encoder on a fixed cadence rather than from rAF: the encoder
      // expects frames at a steady rate, and a variable one shows up as
      // stuttering playback even when every frame arrives.
      pumpRef.current = setInterval(() => {
        const bytes = m.frameBytes();
        invoke('push_frame', { frame: Array.from(bytes) }).catch((e) => {
          setError(String(e));
          void stopLive();
        });
      }, Math.round(1000 / cfg.fps));
    } catch (e) {
      setError(String(e));
    }
  };

  const stopLive = async () => {
    if (pumpRef.current) { clearInterval(pumpRef.current); pumpRef.current = null; }
    try { await invoke('stop_broadcast'); } catch { /* already stopped */ }
    setLive(false);
  };

  const slotCount = LAYOUTS.find((l) => l.id === cfg.layout)?.slots ?? 1;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr 300px', height: '100vh', gap: 1, background: 'var(--border)' }}>

      {/* ── Sources ──────────────────────────────────────────────── */}
      <aside style={{ background: 'var(--bg)', padding: 16, overflowY: 'auto' }} className="col">
        <div className="row" style={{ gap: 8, marginBottom: 4 }}>
          <div style={{ width: 22, height: 22, borderRadius: 11, background: 'var(--brand)',
                        display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 0, height: 0, marginLeft: 2,
                          borderLeft: '7px solid #fff', borderTop: '5px solid transparent',
                          borderBottom: '5px solid transparent' }} />
          </div>
          <strong style={{ fontSize: 14 }}>MultiCam</strong>
        </div>

        <div className="label">Sources</div>
        <div className="col" style={{ gap: 6 }}>
          {sources.length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 12, padding: '10px 0' }}>
              No sources yet. Add a camera to begin.
            </div>
          )}
          {sources.map((s) => (
            <div key={s.id} className="spread"
                 style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                          borderRadius: 9, padding: '9px 11px' }}>
              <span style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }} title={s.label}>
                {s.label}
              </span>
              <button className="ghost" style={{ padding: '3px 8px', fontSize: 11 }}
                      onClick={() => { mixerRef.current?.removeSource(s.id); sync(); }}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <button className="primary" onClick={() => addCamera()}>+ Add camera</button>
        <button onClick={addScreen}>+ Share screen</button>

        {cameras.length > 1 && (
          <>
            <div className="label" style={{ marginTop: 6 }}>Available cameras</div>
            <select onChange={(e) => e.target.value && addCamera(e.target.value)} value="">
              <option value="">Choose a camera…</option>
              {cameras.map((c) => (
                <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
              ))}
            </select>
          </>
        )}
      </aside>

      {/* ── Programme ────────────────────────────────────────────── */}
      <main style={{ background: 'var(--bg)', padding: 16, display: 'flex',
                     flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div className="spread">
          <div className="row">
            {live
              ? <span className="row" style={{ gap: 6, color: 'var(--live)', fontWeight: 600, fontSize: 13 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--live)' }} />
                  ON AIR
                </span>
              : <span style={{ color: 'var(--muted)', fontSize: 13 }}>Preview</span>}
          </div>
          <span style={{ color: fps < cfg.fps * 0.8 ? 'var(--live)' : 'var(--muted)', fontSize: 12 }}>
            {fps} fps · {res.label}
          </span>
        </div>

        <div style={{ flex: 1, display: 'grid', placeItems: 'center', minHeight: 0 }}>
          <canvas
            ref={previewRef}
            width={1280}
            height={720}
            style={{
              maxWidth: '100%', maxHeight: '100%', aspectRatio: '16 / 9',
              background: '#000', borderRadius: 12,
              border: live ? '2px solid var(--live)' : '1px solid var(--border)',
            }}
          />
        </div>

        {/* Layouts */}
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {LAYOUTS.map((l) => (
            <button key={l.id}
                    className={cfg.layout === l.id ? 'active' : 'ghost'}
                    onClick={() => changeLayout(l.id)}>
              {l.label}
            </button>
          ))}
        </div>

        {/* Slot assignment — which source appears where. */}
        {sources.length > 0 && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {Array.from({ length: slotCount }).map((_, i) => (
              <div key={i} className="row" style={{ gap: 6 }}>
                <span className="label">{i === 0 ? 'Main' : `Slot ${i + 1}`}</span>
                <select value={cfg.slots[i] ?? ''} onChange={(e) => setSlot(i, e.target.value)}
                        style={{ width: 160 }}>
                  <option value="">Empty</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── Output ───────────────────────────────────────────────── */}
      <aside style={{ background: 'var(--bg)', padding: 16, overflowY: 'auto' }} className="col">
        <div className="label">Broadcast</div>

        <div className="col" style={{ gap: 8 }}>
          <div>
            <div className="label" style={{ marginBottom: 5 }}>RTMP server</div>
            <input value={rtmpUrl} onChange={(e) => setRtmpUrl(e.target.value)}
                   disabled={live} spellCheck={false} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 5 }}>Stream key</div>
            <input type="password" value={streamKey} placeholder="Paste your stream key"
                   onChange={(e) => setStreamKey(e.target.value)} disabled={live} spellCheck={false} />
          </div>
          <div>
            <div className="label" style={{ marginBottom: 5 }}>Quality</div>
            <select value={res.label} disabled={live}
                    onChange={(e) => setRes(RESOLUTIONS.find((r) => r.label === e.target.value)!)}>
              {RESOLUTIONS.map((r) => (
                <option key={r.label} value={r.label}>{r.label} · {r.bitrate} kbps</option>
              ))}
            </select>
          </div>
        </div>

        {live
          ? <button className="danger" onClick={stopLive}>Stop broadcast</button>
          : <button className="primary" disabled={!streamKey.trim() || !ffmpegOk} onClick={goLive}>
              Go live
            </button>}

        <div className="label" style={{ marginTop: 6 }}>Lower third</div>
        <input placeholder="Speaker name or title"
               value={cfg.lowerThirdText}
               onChange={(e) => { mixerRef.current?.setConfig({ lowerThirdText: e.target.value }); sync(); }} />
        <button className={cfg.showLowerThird ? 'active' : 'ghost'}
                onClick={() => { mixerRef.current?.setConfig({ showLowerThird: !cfg.showLowerThird }); sync(); }}>
          {cfg.showLowerThird ? 'Hide' : 'Show'} lower third
        </button>

        {/* Honest status rather than a silent failure at the worst moment. */}
        <div className="card" style={{ marginTop: 'auto', fontSize: 12, color: 'var(--muted)' }}>
          <div className="spread" style={{ marginBottom: 6 }}>
            <span>Encoder</span>
            <span style={{ color: ffmpegOk ? 'var(--ok)' : 'var(--live)' }}>
              {ffmpegOk ? 'Ready' : 'Missing'}
            </span>
          </div>
          {error && <div style={{ color: 'var(--live)', lineHeight: 1.5 }}>{error}</div>}
          {!error && !ffmpegOk && <div>Reinstall MultiCam to restore the encoder.</div>}
        </div>
      </aside>
    </div>
  );
}
