/**
 * The mixer.
 *
 * Every camera, screen share and still is drawn onto one canvas each frame.
 * That canvas is the programme: what the audience sees, what goes to the big
 * screen, and what gets encoded. One surface, one truth — the operator's
 * preview and the broadcast cannot drift apart.
 *
 * Why a canvas rather than native compositing:
 *
 *  • The browser's media stack already decodes every camera efficiently on the
 *    GPU, and `drawImage` from a <video> is a GPU blit, not a pixel copy.
 *  • Layouts become arithmetic instead of driver work, so adding a
 *    three-camera layout is twenty lines rather than a new native code path.
 *  • It runs identically on Windows, macOS and Linux, which matters when the
 *    machine at the venue is whatever was already there.
 *
 * The render loop is driven by `requestAnimationFrame` while visible, with a
 * timer fallback. rAF is throttled hard when a window is minimised — correct
 * for a web page, catastrophic for a broadcast — and an operator absolutely
 * will minimise this window mid-service.
 */

export type LayoutId =
  | 'single' | 'pip' | 'side-by-side' | 'stacked' | 'grid-3' | 'grid-4';

export interface Source {
  id: string;
  label: string;
  kind: 'camera' | 'screen' | 'image';
  stream?: MediaStream;
  element?: HTMLVideoElement | HTMLImageElement;
  /** Hidden from layouts without being torn down — lets a source stay warm. */
  enabled: boolean;
}

export interface MixerConfig {
  width: number;
  height: number;
  fps: number;
  layout: LayoutId;
  /** Source ids in slot order. Slot 0 is the main picture. */
  slots: string[];
  pipCorner: 'tl' | 'tr' | 'bl' | 'br';
  background: string;
  showLowerThird: boolean;
  lowerThirdText: string;
}

export const LAYOUTS: { id: LayoutId; label: string; slots: number }[] = [
  { id: 'single',       label: 'Single',        slots: 1 },
  { id: 'pip',          label: 'Picture-in-picture', slots: 2 },
  { id: 'side-by-side', label: 'Side by side',  slots: 2 },
  { id: 'stacked',      label: 'Stacked',       slots: 2 },
  { id: 'grid-3',       label: 'Three up',      slots: 3 },
  { id: 'grid-4',       label: 'Quad',          slots: 4 },
];

type Rect = { x: number; y: number; w: number; h: number };

/** Where each slot sits, per layout. Normalised 0–1 so it scales to any canvas. */
function slotRects(layout: LayoutId, corner: MixerConfig['pipCorner']): Rect[] {
  const full: Rect = { x: 0, y: 0, w: 1, h: 1 };
  switch (layout) {
    case 'single':
      return [full];
    case 'pip': {
      const w = 0.26, h = 0.26 * (16 / 9) * (9 / 16), m = 0.025;
      const x = corner.endsWith('r') ? 1 - w - m : m;
      const y = corner.startsWith('b') ? 1 - h - m : m;
      return [full, { x, y, w, h }];
    }
    case 'side-by-side':
      return [{ x: 0, y: 0.25, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.25, w: 0.5, h: 0.5 }];
    case 'stacked':
      return [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }];
    case 'grid-3':
      return [
        { x: 0, y: 0.125, w: 0.5, h: 0.75 },
        { x: 0.5, y: 0.125, w: 0.5, h: 0.375 },
        { x: 0.5, y: 0.5, w: 0.5, h: 0.375 },
      ];
    case 'grid-4':
      return [
        { x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      ];
  }
}

/** Draw with object-fit: cover semantics — crop, never squash a face. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  el: HTMLVideoElement | HTMLImageElement,
  d: Rect,
) {
  const sw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const sh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!sw || !sh) return;
  const scale = Math.max(d.w / sw, d.h / sh);
  const cw = d.w / scale, ch = d.h / scale;
  ctx.drawImage(el, (sw - cw) / 2, (sh - ch) / 2, cw, ch, d.x, d.y, d.w, d.h);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Mixer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private raf: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sources = new Map<string, Source>();
  private cfg: MixerConfig;
  private running = false;

  /** Frames actually rendered in the last second — the honest health signal. */
  private frameCount = 0;
  private lastFpsAt = 0;
  fps = 0;

  constructor(cfg: MixerConfig) {
    this.cfg = cfg;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cfg.width;
    this.canvas.height = cfg.height;
    const ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Could not create a 2D drawing context.');
    this.ctx = ctx;
  }

  setConfig(patch: Partial<MixerConfig>) {
    const resized = (patch.width && patch.width !== this.cfg.width)
                 || (patch.height && patch.height !== this.cfg.height);
    this.cfg = { ...this.cfg, ...patch };
    if (resized) {
      this.canvas.width = this.cfg.width;
      this.canvas.height = this.cfg.height;
    }
  }

  getConfig(): MixerConfig { return { ...this.cfg }; }

  /**
   * Register a source and get it decoding.
   *
   * The <video> is muted and plays inline: an unmuted element would put the
   * room's own audio through the operator's speakers and feed back into the
   * mic within seconds. Audio is handled separately and deliberately.
   */
  async addSource(src: Source): Promise<void> {
    if (src.stream && !src.element) {
      const el = document.createElement('video');
      el.srcObject = src.stream;
      el.muted = true;
      el.playsInline = true;
      el.autoplay = true;
      await el.play().catch(() => { /* autoplay of a muted local stream */ });
      src.element = el;
    }
    this.sources.set(src.id, src);
  }

  removeSource(id: string) {
    const s = this.sources.get(id);
    s?.stream?.getTracks().forEach((t) => t.stop());
    if (s?.element instanceof HTMLVideoElement) s.element.srcObject = null;
    this.sources.delete(id);
  }

  getSources(): Source[] { return [...this.sources.values()]; }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastFpsAt = performance.now();

    const tick = () => {
      if (!this.running) return;
      this.render();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);

    // Backstop for a minimised or hidden window, where rAF is throttled to
    // roughly 1Hz. Without this the broadcast freezes the moment an operator
    // switches to another app — which they will, to read comments.
    this.timer = setInterval(() => {
      if (this.running && document.hidden) this.render();
    }, Math.round(1000 / this.cfg.fps));
  }

  stop() {
    this.running = false;
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    if (this.timer !== null) clearInterval(this.timer);
    this.raf = null;
    this.timer = null;
  }

  /** A MediaStream of the mixed programme — for preview or WebRTC. */
  captureStream(): MediaStream {
    return this.canvas.captureStream(this.cfg.fps);
  }

  /** Raw RGBA bytes of the current frame, for the encoder. */
  frameBytes(): Uint8ClampedArray {
    return this.ctx.getImageData(0, 0, this.cfg.width, this.cfg.height).data;
  }

  private render() {
    const { ctx, cfg } = this;
    const W = cfg.width, H = cfg.height;

    ctx.fillStyle = cfg.background;
    ctx.fillRect(0, 0, W, H);

    const rects = slotRects(cfg.layout, cfg.pipCorner);
    const isPip = cfg.layout === 'pip';

    rects.forEach((r, i) => {
      const id = cfg.slots[i];
      if (!id) return;
      const src = this.sources.get(id);
      if (!src?.element || !src.enabled) return;

      const d: Rect = { x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H };

      // The inset gets rounded corners and a hairline so it reads as a panel
      // over the shot rather than a hole punched in it.
      if (isPip && i === 1) {
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.45)';
        ctx.shadowBlur = W * 0.012;
        ctx.shadowOffsetY = H * 0.005;
        roundRect(ctx, d.x, d.y, d.w, d.h, W * 0.010);
        ctx.fillStyle = '#000';
        ctx.fill();
        ctx.restore();

        ctx.save();
        roundRect(ctx, d.x, d.y, d.w, d.h, W * 0.010);
        ctx.clip();
        drawCover(ctx, src.element, d);
        ctx.restore();

        ctx.save();
        roundRect(ctx, d.x, d.y, d.w, d.h, W * 0.010);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = Math.max(1, W * 0.0015);
        ctx.stroke();
        ctx.restore();
      } else {
        drawCover(ctx, src.element, d);
      }
    });

    if (cfg.showLowerThird && cfg.lowerThirdText.trim()) {
      this.drawLowerThird(cfg.lowerThirdText.trim());
    }

    // Measured, not assumed. A dropped-frame count the operator can see is
    // what turns "the stream looked bad" into something diagnosable.
    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsAt >= 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsAt));
      this.frameCount = 0;
      this.lastFpsAt = now;
    }
  }

  /** Name/title strap. Sized off canvas width so it holds at any resolution. */
  private drawLowerThird(text: string) {
    const { ctx, cfg } = this;
    const W = cfg.width, H = cfg.height;
    const pad = W * 0.022;
    const fontSize = Math.round(H * 0.042);

    ctx.font = `600 ${fontSize}px -apple-system, "Segoe UI", Roboto, sans-serif`;
    const metrics = ctx.measureText(text);
    const boxW = metrics.width + pad * 2;
    const boxH = fontSize * 1.9;
    const x = W * 0.05;
    const y = H - boxH - H * 0.09;

    ctx.save();
    ctx.globalAlpha = 0.92;
    roundRect(ctx, x, y, boxW, boxH, boxH * 0.18);
    ctx.fillStyle = '#0A0818';
    ctx.fill();
    // A brand keyline rather than a brand-coloured slab: readable over any
    // footage, and it does not fight the picture.
    ctx.fillStyle = '#6D28D9';
    ctx.fillRect(x, y, Math.max(3, W * 0.004), boxH);
    ctx.restore();

    ctx.fillStyle = '#FFFFFF';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + pad, y + boxH / 2);
  }
}

export const DEFAULT_CONFIG: MixerConfig = {
  width: 1920,
  height: 1080,
  fps: 30,
  layout: 'single',
  slots: [],
  pipCorner: 'br',
  background: '#000000',
  showLowerThird: false,
  lowerThirdText: '',
};
