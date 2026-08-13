'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getDeviceProfile, type DeviceProfile } from '@/lib/device';

/**
 * Camera capture for the Go Live page — one camera, or two at once.
 *
 * ── Why a canvas sits in the middle ──────────────────────────────
 * A broadcast carries exactly one video track. Two cameras produce two, so
 * "front and back at the same time" has to become a single picture somewhere,
 * and that somewhere is a canvas: both feeds are drawn every frame — one
 * filling the frame, the other inset as a picture-in-picture panel — and
 * `canvas.captureStream()` hands back a normal MediaStream carrying the
 * composed result. Downstream, nothing can tell it came from two cameras,
 * which is what keeps this from touching the streaming pipeline at all.
 *
 * In single-camera mode the canvas is skipped entirely and the raw camera
 * stream is passed straight through, exactly as before. Compositing costs a
 * little CPU, so it is only paid when there are actually two feeds to mix.
 *
 * ── Two cameras will not always open ─────────────────────────────
 * iOS refuses outright (see lib/device.ts), Android is hardware-dependent, and
 * a USB camera can be claimed by another app. So the second camera is opened
 * *after* the first is already running and safe: if it fails, we keep the
 * working single-camera stream, report why, and drop back to single layout.
 * Starting the camera never fails because of a second camera.
 *
 * Audio is taken from the primary camera only. Two microphones on one device
 * pick up the same room a few milliseconds apart, which sounds like an echo.
 */

export type CamLayout = 'single' | 'pip';
export type PipCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** How to ask for a camera: by facing direction (phones) or by device id (computers). */
export type CamSource =
  | { kind: 'facing'; facing: 'user' | 'environment' }
  | { kind: 'device'; deviceId: string };

export interface CamDevice { deviceId: string; label: string; }

const W = 1280;
const H = 720;
const PIP_SCALE  = 0.28;   // inset width as a fraction of the frame
const PIP_MARGIN = 0.03;
const PIP_RADIUS = 16;

function constraintsFor(src: CamSource): MediaTrackConstraints {
  const base: MediaTrackConstraints = { width: { ideal: W }, height: { ideal: H } };
  if (src.kind === 'device') return { ...base, deviceId: { exact: src.deviceId } };
  // `ideal` rather than `exact`: a laptop has no environment-facing camera, and
  // `exact` would throw OverconstrainedError instead of returning what it has.
  return { ...base, facingMode: { ideal: src.facing } };
}

/** Draw `video` into `ctx` with object-fit: cover semantics (crop, never squash). */
function drawCover(
  ctx: CanvasRenderingContext2D, video: HTMLVideoElement,
  dx: number, dy: number, dw: number, dh: number,
) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return;
  const scale = Math.max(dw / vw, dh / vh);
  const sw = dw / scale, sh = dh / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh);
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

/** A detached <video> used only to decode a stream so the canvas can draw it. */
function makeVideoEl(): HTMLVideoElement {
  const el = document.createElement('video');
  el.autoplay = true;
  el.muted = true;
  el.playsInline = true;
  // Some browsers won't decode a fully detached element; keep it in the
  // document but visually gone and out of the accessibility tree.
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'fixed', width: '1px', height: '1px',
    opacity: '0', pointerEvents: 'none', top: '-10px', left: '-10px',
  } as CSSStyleDeclaration);
  return el;
}

export function useMultiCam(opts: { audio?: boolean } = {}) {
  const wantAudio = opts.audio ?? true;

  const [profile]      = useState<DeviceProfile>(() => getDeviceProfile());
  const [devices, setDevices]       = useState<CamDevice[]>([]);
  const [running, setRunning]       = useState(false);
  const [starting, setStarting]     = useState(false);
  const [layout, setLayoutState]    = useState<CamLayout>('single');
  const [pipCorner, setPipCorner]   = useState<PipCorner>('bottom-right');
  const [dualError, setDualError]   = useState<string | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [outputStream, setOutputStream] = useState<MediaStream | null>(null);
  /** Which physical camera is currently the big one. */
  const [primarySource, setPrimarySource]     = useState<CamSource>({ kind: 'facing', facing: 'user' });
  const [secondarySource, setSecondarySource] = useState<CamSource | null>(null);

  const primaryRef   = useRef<MediaStream | null>(null);
  const secondaryRef = useRef<MediaStream | null>(null);
  const videoARef    = useRef<HTMLVideoElement | null>(null);
  const videoBRef    = useRef<HTMLVideoElement | null>(null);
  const canvasRef    = useRef<HTMLCanvasElement | null>(null);
  const canvasStream = useRef<MediaStream | null>(null);
  const rafRef       = useRef<number | null>(null);
  const layoutRef    = useRef<CamLayout>('single');
  const cornerRef    = useRef<PipCorner>('bottom-right');

  // The draw loop reads these every frame; refs keep it from being torn down
  // and rebuilt each time the creator flips a control.
  useEffect(() => { layoutRef.current = layout; },    [layout]);
  useEffect(() => { cornerRef.current = pipCorner; }, [pipCorner]);

  // ── Device list ──────────────────────────────────────────────────
  // Labels are blank until permission has been granted at least once, so this
  // is refreshed after the camera starts as well as on mount.
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(
        all.filter((d) => d.kind === 'videoinput')
           .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` })),
      );
    } catch { /* enumeration is best-effort */ }
  }, []);

  useEffect(() => {
    refreshDevices();
    if (!navigator.mediaDevices?.addEventListener) return;
    // A camera being plugged in or unplugged mid-setup should update the list.
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, [refreshDevices]);

  // ── Compositor ───────────────────────────────────────────────────
  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
  }, []);

  const startLoop = useCallback(() => {
    stopLoop();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const tick = () => {
      const a = videoARef.current, b = videoBRef.current;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      if (a && a.readyState >= 2) drawCover(ctx, a, 0, 0, W, H);

      if (layoutRef.current === 'pip' && b && b.readyState >= 2) {
        const pw = Math.round(W * PIP_SCALE);
        const ph = Math.round(pw * (H / W));
        const m  = Math.round(W * PIP_MARGIN);
        const corner = cornerRef.current;
        const px = corner.endsWith('right')  ? W - pw - m : m;
        const py = corner.startsWith('bottom') ? H - ph - m : m;

        ctx.save();
        // Drop shadow reads as a panel floating over the main shot rather than
        // a hole punched in it.
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 6;
        roundedPath(ctx, px, py, pw, ph, PIP_RADIUS);
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.restore();

        ctx.save();
        roundedPath(ctx, px, py, pw, ph, PIP_RADIUS);
        ctx.clip();
        drawCover(ctx, b, px, py, pw, ph);
        ctx.restore();

        ctx.save();
        roundedPath(ctx, px, py, pw, ph, PIP_RADIUS);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopLoop]);

  /**
   * Build the stream handed to the preview and, later, the broadcast.
   * Single → the camera stream itself. Dual → composited canvas video plus the
   * primary camera's audio track (the same track object, so muting either
   * reference mutes both).
   */
  const buildOutput = useCallback((mode: CamLayout) => {
    const primary = primaryRef.current;
    if (!primary) return;

    if (mode === 'single') {
      stopLoop();
      setOutputStream(primary);
      return;
    }

    if (!canvasRef.current) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      canvasRef.current = c;
    }
    startLoop();

    if (!canvasStream.current) {
      canvasStream.current = canvasRef.current.captureStream(30);
    }
    const out = new MediaStream();
    canvasStream.current.getVideoTracks().forEach((t) => out.addTrack(t));
    primary.getAudioTracks().forEach((t) => out.addTrack(t));
    setOutputStream(out);
  }, [startLoop, stopLoop]);

  // ── Secondary camera ─────────────────────────────────────────────
  const stopSecondary = useCallback(() => {
    secondaryRef.current?.getTracks().forEach((t) => t.stop());
    secondaryRef.current = null;
    if (videoBRef.current) {
      videoBRef.current.srcObject = null;
      videoBRef.current.remove();
      videoBRef.current = null;
    }
  }, []);

  /**
   * Open the second camera and switch to picture-in-picture.
   * Returns true on success. On failure the first camera keeps running
   * untouched and `dualError` explains why.
   */
  const enableDual = useCallback(async (src?: CamSource): Promise<boolean> => {
    if (!primaryRef.current) return false;
    setDualError(null);

    // Default the second camera to the opposite of the first.
    let want: CamSource;
    if (src) {
      want = src;
    } else if (primarySource.kind === 'facing') {
      want = { kind: 'facing', facing: primarySource.facing === 'user' ? 'environment' : 'user' };
    } else {
      const other = devices.find((d) => d.deviceId !== (primarySource as { deviceId: string }).deviceId);
      if (!other) {
        setDualError('Only one camera was found on this device. Connect a second camera to use both at once.');
        return false;
      }
      want = { kind: 'device', deviceId: other.deviceId };
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: constraintsFor(want), audio: false });

      // iOS in particular can "succeed" here while quietly killing the first
      // camera. If the primary is no longer live, undo and stay single.
      const primaryAlive = primaryRef.current?.getVideoTracks().some((t) => t.readyState === 'live');
      if (!primaryAlive) {
        s.getTracks().forEach((t) => t.stop());
        setDualError(
          'This device can only run one camera at a time in the browser. ' +
          'You can switch between front and back instead.',
        );
        return false;
      }

      stopSecondary();
      secondaryRef.current = s;
      const el = makeVideoEl();
      document.body.appendChild(el);
      el.srcObject = s;
      await el.play().catch(() => { /* autoplay of a muted local stream */ });
      videoBRef.current = el;

      setSecondarySource(want);
      setLayoutState('pip');
      layoutRef.current = 'pip';
      buildOutput('pip');
      refreshDevices();
      return true;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      setDualError(
        name === 'NotReadableError' || name === 'AbortError'
          ? 'This device couldn\'t start a second camera — its hardware only allows one at a time, or another app is using it.'
          : name === 'NotAllowedError'
            ? 'Camera permission was declined for the second camera.'
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? 'No second camera was found on this device.'
              : 'Couldn\'t start the second camera on this device.',
      );
      return false;
    }
  }, [primarySource, devices, buildOutput, stopSecondary, refreshDevices]);

  const disableDual = useCallback(() => {
    stopSecondary();
    setSecondarySource(null);
    setLayoutState('single');
    layoutRef.current = 'single';
    setDualError(null);
    buildOutput('single');
  }, [stopSecondary, buildOutput]);

  // ── Primary camera ───────────────────────────────────────────────
  const start = useCallback(async (src?: CamSource): Promise<boolean> => {
    if (starting) return false;
    setStarting(true);
    setError(null);
    const want = src ?? primarySource;

    try {
      let s: MediaStream;
      try {
        // Preferred path: acquire the new camera *before* releasing the old
        // one, so a failed switch leaves the creator with a working preview.
        s = await navigator.mediaDevices.getUserMedia({
          video: constraintsFor(want),
          audio: wantAudio,
        });
      } catch (firstErr: unknown) {
        const n = (firstErr as { name?: string })?.name;
        const busy = n === 'NotReadableError' || n === 'AbortError';
        // Phones typically refuse a second concurrent capture session, so
        // switching front→back fails while the old camera is still held. Let
        // go and try once more — this is the normal path on mobile.
        if (!busy || !primaryRef.current) throw firstErr;
        primaryRef.current.getTracks().forEach((t) => t.stop());
        primaryRef.current = null;
        s = await navigator.mediaDevices.getUserMedia({
          video: constraintsFor(want),
          audio: wantAudio,
        });
      }

      // Replace any previous primary only once the new one is in hand, so a
      // failed switch leaves the creator with the camera they already had.
      primaryRef.current?.getTracks().forEach((t) => t.stop());
      primaryRef.current = s;

      if (!videoARef.current) {
        const el = makeVideoEl();
        document.body.appendChild(el);
        videoARef.current = el;
      }
      videoARef.current.srcObject = s;
      await videoARef.current.play().catch(() => { /* muted local stream */ });

      setPrimarySource(want);
      setRunning(true);
      buildOutput(layoutRef.current === 'pip' && secondaryRef.current ? 'pip' : 'single');
      refreshDevices();
      return true;
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Please allow camera access to preview your stream.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : 'Could not access your camera — check your device permissions.',
      );
      return false;
    } finally {
      setStarting(false);
    }
  }, [starting, primarySource, wantAudio, buildOutput, refreshDevices]);

  const stop = useCallback(() => {
    stopLoop();
    stopSecondary();
    primaryRef.current?.getTracks().forEach((t) => t.stop());
    primaryRef.current = null;
    if (videoARef.current) {
      videoARef.current.srcObject = null;
      videoARef.current.remove();
      videoARef.current = null;
    }
    canvasStream.current?.getTracks().forEach((t) => t.stop());
    canvasStream.current = null;
    canvasRef.current = null;
    setOutputStream(null);
    setRunning(false);
    setLayoutState('single');
    layoutRef.current = 'single';
    setSecondarySource(null);
    setDualError(null);
  }, [stopLoop, stopSecondary]);

  /** Point the primary camera somewhere else (front ⇆ back, or another device). */
  const switchPrimary = useCallback(async (src: CamSource) => {
    if (!running) { setPrimarySource(src); return true; }
    return start(src);
  }, [running, start]);

  /**
   * Trade places: the inset becomes the full frame and vice versa.
   *
   * The inset's camera is released *before* it is reopened as the primary.
   * Phones will not hand the same physical camera to two capture sessions, so
   * promoting it while the old handle is still open fails with
   * NotReadableError on exactly the devices this feature is aimed at.
   */
  const swap = useCallback(async () => {
    if (layout !== 'pip' || !secondarySource) return false;
    const oldPrimary   = primarySource;
    const newPrimary   = secondarySource;

    stopSecondary();
    setSecondarySource(null);

    const ok = await start(newPrimary);
    if (!ok) {
      // Put things back the way they were rather than leaving one dead panel.
      await enableDual(newPrimary);
      return false;
    }
    return enableDual(oldPrimary);
  }, [layout, secondarySource, primarySource, start, enableDual, stopSecondary]);

  const setMicEnabled = useCallback((on: boolean) => {
    primaryRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
  }, []);

  // Tear everything down if the page goes away mid-setup — a camera left
  // running is a light on someone's laptop that they did not consent to.
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    secondaryRef.current?.getTracks().forEach((t) => t.stop());
    primaryRef.current?.getTracks().forEach((t) => t.stop());
    canvasStream.current?.getTracks().forEach((t) => t.stop());
    videoARef.current?.remove();
    videoBRef.current?.remove();
  }, []);

  return {
    profile, devices, running, starting, layout, pipCorner, dualError, error,
    outputStream, primarySource, secondarySource,
    start, stop, switchPrimary, enableDual, disableDual, swap,
    setPipCorner, setMicEnabled, refreshDevices,
  };
}
