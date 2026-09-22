import { COLOUR_PRESETS, resolveColour, type EditSpec, type OverlayFont, type ColourPreset } from './edit-spec';

/**
 * Turning an edit spec into ffmpeg arguments.
 *
 * Separated from the worker so it can be tested without running ffmpeg,
 * downloading a video, or standing up a queue — the filtergraph is the part
 * most likely to be subtly wrong, and the part where a mistake is most
 * expensive to discover on a real export.
 */

/**
 * Fonts resolved from a fixed key, never a caller-supplied path.
 *
 * `drawtext` takes a fontfile path. Accepting a path from the request would
 * let a caller point ffmpeg at any readable file on the server, so the schema
 * restricts input to these keys and the mapping happens here.
 *
 * These are the DejaVu faces shipped with Ubuntu's fonts-dejavu-core, which
 * stage 1 already installs as a dependency of other packages. No extra
 * install, and they cover Latin, Cyrillic and Greek.
 */
const FONT_FILES: Record<OverlayFont, string> = {
  'sans':      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  'sans-bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  'serif':     '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
  'mono':      '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
};

/** Margin from the frame edge, as a fraction of height. */
const EDGE = 0.04;

/**
 * x/y expressions for drawtext.
 *
 * Expressed in terms of ffmpeg's own `w`, `h`, `text_w` and `text_h` rather
 * than pixel numbers, so the same spec positions correctly on any resolution —
 * which matters because a recording may be 720p or 1080p depending on the
 * broadcaster's camera.
 */
function positionExpr(position: string): { x: string; y: string } {
  const [vertical, horizontal] = position.split('-');
  const x =
    horizontal === 'left'  ? `${EDGE}*h` :
    horizontal === 'right' ? `w-text_w-${EDGE}*h` :
                             '(w-text_w)/2';
  const y =
    vertical === 'top'    ? `${EDGE}*h` :
    vertical === 'bottom' ? `h-text_h-${EDGE}*h` :
                            '(h-text_h)/2';
  return { x, y };
}

/**
 * Escape a string for a drawtext value.
 *
 * The schema already strips newlines and bounds the length, so this handles
 * the characters that carry meaning inside a filtergraph. Backslash first, or
 * it would escape the escapes added afterwards.
 */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/;/g, '\\;');
}

/** ffmpeg wants 0xRRGGBB, the UI speaks #RRGGBB. */
function hexToFfmpeg(hex: string, opacity?: number): string {
  const c = `0x${hex.replace('#', '').toUpperCase()}`;
  return opacity != null && opacity < 1 ? `${c}@${opacity.toFixed(2)}` : c;
}

export interface BuiltFilters {
  /** Video filters, in order. Empty when nothing changes the picture. */
  video: string[];
  /** True when the spec needs a second input and an audio mix. */
  needsMusic: boolean;
  /** The complex audio graph, when music is involved. */
  audioComplex: string | null;
  /** Extra input arguments for the music file, in order. */
  musicInputArgs: string[];
}

/**
 * Build the filters for a spec.
 *
 * `outputDuration` is the length of the *result*, after any trim — needed
 * because a fade-out and a music fade both have to be anchored to the end of
 * the output, not the end of the source.
 */
export function buildFilters(
  spec: EditSpec,
  opts: { outputDuration: number; musicPath?: string | null },
): BuiltFilters {
  const video: string[] = [];

  // ── Colour ────────────────────────────────────────────────────────
  const colour = resolveColour(spec.colour);
  const neutral =
    colour.brightness === 1 && colour.contrast === 1 && colour.saturation === 1;

  if (!neutral) {
    // One eq filter, not three chained: chaining applies each in sequence and
    // compounds rounding, and costs three passes over every frame.
    //
    // eq=brightness is -1..1 around a neutral 0, while the spec uses 0..2
    // around a neutral 1, so it shifts by one. contrast and saturation are
    // already multipliers and pass through unchanged.
    video.push(
      `eq=brightness=${(colour.brightness - 1).toFixed(3)}` +
      `:contrast=${colour.contrast.toFixed(3)}` +
      `:saturation=${colour.saturation.toFixed(3)}`,
    );
  }

  if (colour.sharpen > 0) {
    // 5x5 luma only. Sharpening chroma on video compressed at 4:2:0 amplifies
    // colour-fringing artefacts rather than adding detail.
    video.push(`unsharp=5:5:${colour.sharpen.toFixed(2)}:5:5:0`);
  }

  // ── Fades ─────────────────────────────────────────────────────────
  const fadeIn  = spec.transitions?.find((t) => t.type === 'fade-in');
  const fadeOut = spec.transitions?.find((t) => t.type === 'fade-out');
  if (fadeIn && fadeIn.duration > 0) {
    video.push(`fade=t=in:st=0:d=${fadeIn.duration}`);
  }
  if (fadeOut && fadeOut.duration > 0 && opts.outputDuration > 0) {
    const st = Math.max(0, opts.outputDuration - fadeOut.duration);
    video.push(`fade=t=out:st=${st.toFixed(2)}:d=${fadeOut.duration}`);
  }

  // ── Text overlays ─────────────────────────────────────────────────
  for (const t of spec.text ?? []) {
    const { x, y } = positionExpr(t.position);
    const parts = [
      `fontfile=${FONT_FILES[t.font]}`,
      `text='${escapeText(t.content)}'`,
      // Relative to frame height, so the same spec looks right at any
      // resolution.
      `fontsize=h*${(t.sizePct / 100).toFixed(4)}`,
      `fontcolor=${hexToFfmpeg(t.colour)}`,
      `x=${x}`,
      `y=${y}`,
    ];
    if (t.box) {
      parts.push('box=1', `boxcolor=${hexToFfmpeg(t.boxColour, t.boxOpacity)}`, 'boxborderw=h*0.012');
    }
    // Timed overlays. `between` is inclusive and works on output timestamps,
    // which is what the UI's numbers refer to after a trim.
    if (t.startAt != null || t.endAt != null) {
      const from = t.startAt ?? 0;
      const to   = t.endAt ?? (opts.outputDuration || 86_400);
      if (to > from) parts.push(`enable='between(t,${from},${to})'`);
    }
    video.push(`drawtext=${parts.join(':')}`);
  }

  // ── Audio ─────────────────────────────────────────────────────────
  const music = spec.audio?.musicUrl && opts.musicPath ? opts.musicPath : null;
  const originalVolume = spec.audio?.originalVolume ?? 1;

  if (!music) {
    // No second input. A volume change on its own is a simple filter; leaving
    // it null means the worker copies the audio untouched.
    return {
      video,
      needsMusic: false,
      audioComplex: originalVolume === 1
        ? null
        : `[0:a]volume=${originalVolume.toFixed(2)}[aout]`,
      musicInputArgs: [],
    };
  }

  const musicVolume = spec.audio?.musicVolume ?? 0.3;
  const fade        = spec.audio?.fadeSeconds ?? 2;
  const loop        = spec.audio?.loopMusic ?? true;

  const musicChain: string[] = [`volume=${musicVolume.toFixed(2)}`];
  if (fade > 0) {
    musicChain.push(`afade=t=in:st=0:d=${fade}`);
    if (opts.outputDuration > fade) {
      musicChain.push(`afade=t=out:st=${(opts.outputDuration - fade).toFixed(2)}:d=${fade}`);
    }
  }
  // Trim the music to the video's length, or a long track would extend the
  // output past the end of the picture.
  musicChain.push(`atrim=0:${Math.max(0.1, opts.outputDuration).toFixed(2)}`);

  const audioComplex =
    originalVolume === 0
      // The original is muted entirely — "remove the original sound". Mixing
      // in a silent track would still shift levels through amix's
      // normalisation, so the music simply becomes the output.
      ? `[1:a]${musicChain.join(',')}[aout]`
      : `[0:a]volume=${originalVolume.toFixed(2)}[a0];` +
        `[1:a]${musicChain.join(',')}[a1];` +
        // duration=first keeps the output as long as the video; dropout_transition=0
        // stops amix raising the music when the speech pauses, which otherwise
        // sounds like the track surging between sentences.
        `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;

  return {
    video,
    needsMusic: true,
    audioComplex,
    // -stream_loop must come before the input it applies to.
    musicInputArgs: loop ? ['-stream_loop', '-1', '-i', music] : ['-i', music],
  };
}

export { COLOUR_PRESETS, type ColourPreset };
