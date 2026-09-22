import { z } from 'zod';

/**
 * What an edit is allowed to ask ffmpeg to do.
 *
 * One schema serves both editors. The AI produces this from a prompt; the
 * manual editor produces it from sliders and form fields. Because both end up
 * here, the worker has a single path to execute and a single set of bounds to
 * enforce — rather than a trusted path for the UI and a suspicious one for the
 * model.
 *
 * Every value is bounded, and every bound matches what the corresponding
 * ffmpeg filter actually accepts. That is a safety property, not a nicety:
 * these values are interpolated into a filtergraph string, so a value that
 * clears validation cannot produce a broken graph — or an injected one.
 *
 * `.catch(...)` throughout means one unusable field degrades to "leave this
 * alone" instead of failing an export the user has been waiting on.
 */

/** Colour presets, so a user picks a look rather than three numbers. */
export const COLOUR_PRESETS = {
  none:    { brightness: 1,    contrast: 1,    saturation: 1,   sharpen: 0   },
  // Punchier without the clipped, over-saturated look of a naive boost.
  vivid:   { brightness: 1.03, contrast: 1.12, saturation: 1.35, sharpen: 0.4 },
  // For webcams that render everything slightly flat and grey.
  sharp:   { brightness: 1.02, contrast: 1.18, saturation: 1.05, sharpen: 0.9 },
  warm:    { brightness: 1.05, contrast: 1.05, saturation: 1.15, sharpen: 0.2 },
  cool:    { brightness: 0.98, contrast: 1.08, saturation: 0.95, sharpen: 0.2 },
  // Keeps a little saturation rather than going fully grey, which reads as
  // deliberate rather than broken.
  muted:   { brightness: 1,    contrast: 0.95, saturation: 0.6,  sharpen: 0   },
  mono:    { brightness: 1,    contrast: 1.1,  saturation: 0,    sharpen: 0.3 },
} as const;

export type ColourPreset = keyof typeof COLOUR_PRESETS;

/**
 * Fonts available for text overlays.
 *
 * A fixed list, not a free-text font name. `drawtext` takes a file path, and
 * accepting an arbitrary string there would let a caller point ffmpeg at any
 * file on the server. The paths are resolved by the worker from this key.
 */
export const OVERLAY_FONTS = ['sans', 'sans-bold', 'serif', 'mono'] as const;
export type OverlayFont = typeof OVERLAY_FONTS[number];

export const POSITIONS = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
] as const;

export const editSpecSchema = z.object({
  /** Seconds from the source. */
  trim: z.object({
    start: z.number().min(0).max(86_400).nullable().catch(null),
    end:   z.number().min(0).max(86_400).nullable().catch(null),
  }).nullable().catch(null).optional(),

  /**
   * A named preset, or explicit values, or both.
   *
   * When both are present the explicit values win, so a user can pick "Vivid"
   * and then nudge the saturation without losing the rest of the preset.
   */
  colour: z.object({
    preset:     z.enum(Object.keys(COLOUR_PRESETS) as [ColourPreset, ...ColourPreset[]])
                  .nullable().catch(null).optional(),
    brightness: z.number().min(0).max(2).nullable().catch(null).optional(),
    contrast:   z.number().min(0).max(2).nullable().catch(null).optional(),
    saturation: z.number().min(0).max(3).nullable().catch(null).optional(),
    // unsharp's amount parameter; beyond ~1.5 it produces halos rather than
    // detail, so the bound is lower than ffmpeg's own.
    sharpen:    z.number().min(0).max(1.5).nullable().catch(null).optional(),
  }).nullable().catch(null).optional(),

  transitions: z.array(z.object({
    type:     z.enum(['fade-in', 'fade-out']),
    duration: z.number().min(0).max(30),
  })).max(4).nullable().catch(null).optional(),

  /** Text burned into the video. */
  text: z.array(z.object({
    // Bounded, and control characters stripped: this is interpolated into a
    // filtergraph, where a newline or a quote would break the command apart.
    content:  z.string().min(1).max(120)
                .transform((v) => v.replace(/[\r\n\t]/g, ' ').trim())
                .refine((v) => v.length > 0, 'Text cannot be empty'),
    position: z.enum(POSITIONS).catch('bottom-center'),
    font:     z.enum(OVERLAY_FONTS).catch('sans-bold'),
    // Relative to video height, so a caption sits correctly whether the source
    // is 720p or 1080p. An absolute pixel size would be tiny on one and huge
    // on the other.
    sizePct:  z.number().min(1).max(20).catch(5),
    colour:   z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#FFFFFF'),
    // A readable backdrop. Most overlay text is unreadable over video without
    // one, and a box is more legible than a drop shadow at small sizes.
    box:      z.boolean().catch(true),
    boxColour: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#000000'),
    boxOpacity: z.number().min(0).max(1).catch(0.5),
    /** Seconds within the *output*. Null means the whole video. */
    startAt:  z.number().min(0).max(86_400).nullable().catch(null).optional(),
    endAt:    z.number().min(0).max(86_400).nullable().catch(null).optional(),
  })).max(8).nullable().catch(null).optional(),

  /** Background music mixed under, or over, the original audio. */
  audio: z.object({
    /**
     * A URL to fetch the track from.
     *
     * Restricted to https at execution time. The worker downloads it rather
     * than passing the URL to ffmpeg, so ffmpeg never opens a network handle
     * on input it was given by a caller.
     */
    musicUrl:  z.string().url().nullable().catch(null).optional(),
    /** 0 mutes the original entirely — "remove the original sound". */
    originalVolume: z.number().min(0).max(2).catch(1),
    musicVolume:    z.number().min(0).max(2).catch(0.3),
    /** Loop a short track to cover a long video rather than falling silent. */
    loopMusic: z.boolean().catch(true),
    /** Fade the music in and out so it does not start and stop abruptly. */
    fadeSeconds: z.number().min(0).max(10).catch(2),
  }).nullable().catch(null).optional(),

  /**
   * Burned-in subtitles, generated by speech-to-text.
   *
   * Accepted and validated now so the shape is settled, but the worker refuses
   * it unless SUBTITLES_ENABLED is set. Shipping the schema ahead of the
   * implementation means the UI, the queue payload and the stored spec do not
   * need changing when it is turned on — and a spec written today stays valid.
   */
  subtitles: z.object({
    enabled:  z.boolean().catch(false),
    /** BCP-47, or null to detect from the audio. */
    language: z.string().min(2).max(10).nullable().catch(null).optional(),
    font:     z.enum(OVERLAY_FONTS).catch('sans-bold'),
    sizePct:  z.number().min(1).max(12).catch(4),
    colour:   z.string().regex(/^#[0-9a-fA-F]{6}$/).catch('#FFFFFF'),
    position: z.enum(['bottom-center', 'top-center']).catch('bottom-center'),
  }).nullable().catch(null).optional(),
});

export type EditSpec = z.infer<typeof editSpecSchema>;

/**
 * Collapse a preset and any explicit overrides into final values.
 *
 * Kept here rather than in the worker so the manual editor can show the user
 * exactly what a preset will do before they export.
 */
export function resolveColour(colour: EditSpec['colour']): {
  brightness: number; contrast: number; saturation: number; sharpen: number;
} {
  const base = COLOUR_PRESETS[colour?.preset ?? 'none'];
  return {
    brightness: colour?.brightness ?? base.brightness,
    contrast:   colour?.contrast   ?? base.contrast,
    saturation: colour?.saturation ?? base.saturation,
    sharpen:    colour?.sharpen    ?? base.sharpen,
  };
}
