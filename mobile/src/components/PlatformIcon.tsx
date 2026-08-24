import React from 'react';
import Svg, { Path, Circle, Rect, Defs, LinearGradient, Stop, RadialGradient } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';

/**
 * Platform brand marks.
 *
 * The real glyphs, drawn as paths — previously these were coloured dots, which
 * told a creator nothing at a glance. On a screen where you pick where a
 * broadcast goes, the logo *is* the label; a dot means reading every caption.
 *
 * Each is the official mark in its official colour, because a recoloured brand
 * logo reads as a knock-off. The two monochrome ones (X, TikTok's base) use
 * `currentColor` so they follow the theme rather than disappearing on a light
 * surface — which is exactly what happened to X on the website.
 */

export type PlatformId =
  | 'youtube' | 'facebook' | 'instagram' | 'tiktok'
  | 'twitch' | 'twitter' | 'linkedin' | 'kick';

export function PlatformIcon({
  platform,
  size = 22,
  monochrome,
}: {
  platform: PlatformId;
  size?: number;
  /** Force the theme's ink colour — for dense lists where brand colour is noise. */
  monochrome?: boolean;
}) {
  const { t } = useTheme();
  const c = t.text;

  if (monochrome) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24">
        <Path d={MONO_PATHS[platform]} fill={c} />
      </Svg>
    );
  }

  switch (platform) {
    case 'youtube':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8z"
            fill="#FF0000"
          />
          <Path d="M9.6 15.6 15.8 12 9.6 8.4z" fill="#FFFFFF" />
        </Svg>
      );

    case 'facebook':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx="12" cy="12" r="12" fill="#1877F2" />
          <Path
            d="M16.7 15.5 17.2 12h-3.4V9.7c0-1 .5-1.9 2-1.9h1.5V4.8s-1.4-.2-2.7-.2c-2.7 0-4.5 1.7-4.5 4.7V12H6.9v3.5h3.2V24a12 12 0 0 0 3.7 0v-8.5z"
            fill="#FFFFFF"
          />
        </Svg>
      );

    case 'instagram':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Defs>
            {/* Instagram's mark is a corner-anchored radial, not a linear
                sweep — a linear gradient is the usual give-away of a copy. */}
            <RadialGradient id="ig" cx="30%" cy="107%" r="150%">
              <Stop offset="0%"  stopColor="#FDF497" />
              <Stop offset="5%"  stopColor="#FDF497" />
              <Stop offset="45%" stopColor="#FD5949" />
              <Stop offset="60%" stopColor="#D6249F" />
              <Stop offset="90%" stopColor="#285AEB" />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="24" height="24" rx="6.5" fill="url(#ig)" />
          <Rect x="5" y="5" width="14" height="14" rx="4.4" fill="none" stroke="#FFFFFF" strokeWidth="1.7" />
          <Circle cx="12" cy="12" r="3.4" fill="none" stroke="#FFFFFF" strokeWidth="1.7" />
          <Circle cx="16.4" cy="7.6" r="1.05" fill="#FFFFFF" />
        </Svg>
      );

    case 'tiktok':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          {/* The offset cyan/red pair is the mark; without it this reads as a
              generic music note. */}
          <Path d="M16.9 5.6a4.9 4.9 0 0 1-1.1-2.9h-3.2v12.3a2.5 2.5 0 1 1-1.8-2.4V9.3a5.7 5.7 0 1 0 4.9 5.6V9.2a8 8 0 0 0 4.5 1.4V7.4a4.8 4.8 0 0 1-3.3-1.8z" fill="#25F4EE" transform="translate(-1,-0.6)" />
          <Path d="M16.9 5.6a4.9 4.9 0 0 1-1.1-2.9h-3.2v12.3a2.5 2.5 0 1 1-1.8-2.4V9.3a5.7 5.7 0 1 0 4.9 5.6V9.2a8 8 0 0 0 4.5 1.4V7.4a4.8 4.8 0 0 1-3.3-1.8z" fill="#FE2C55" transform="translate(1,0.6)" />
          <Path d="M16.9 5.6a4.9 4.9 0 0 1-1.1-2.9h-3.2v12.3a2.5 2.5 0 1 1-1.8-2.4V9.3a5.7 5.7 0 1 0 4.9 5.6V9.2a8 8 0 0 0 4.5 1.4V7.4a4.8 4.8 0 0 1-3.3-1.8z" fill={c} />
        </Svg>
      );

    case 'twitch':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M4.3 2 2.5 6.6v15.1h5.2V24h2.9l2.3-2.3h4.2l5.6-5.6V2zm16.3 13.2-3.2 3.2h-5.2l-2.8 2.8v-2.8H5.9V3.9h14.7z" fill="#9146FF" />
          <Path d="M17.2 7.2h-1.9v5.6h1.9zM12 7.2h-1.9v5.6H12z" fill="#9146FF" />
        </Svg>
      );

    case 'twitter': // X — the stored id never changed when the brand did
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path
            d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23z"
            fill={c}
          />
        </Svg>
      );

    case 'linkedin':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x="0" y="0" width="24" height="24" rx="4" fill="#0A66C2" />
          <Path
            d="M7.1 9.4H4.4V19h2.7zM5.75 8.2a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2zM19.6 19h-2.7v-4.7c0-1.2-.4-2-1.5-2-.8 0-1.3.55-1.5 1.08-.1.2-.1.45-.1.7V19H11.1s.04-8.7 0-9.6h2.7v1.36c.36-.56 1-1.35 2.44-1.35 1.78 0 3.36 1.16 3.36 3.66z"
            fill="#FFFFFF"
          />
        </Svg>
      );

    case 'kick':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M3 3h5.3v5.3h2.7V5.7h2.6V3H19v7.9h-2.6v2.2H19V21h-5.4v-2.7h-2.6v-2.6H8.3V21H3z" fill="#53FC18" />
        </Svg>
      );
  }
}

/**
 * Sign-in provider marks.
 *
 * Separate from PlatformIcon because these are *identity* providers, not
 * broadcast destinations — and Google's mark in particular has strict brand
 * rules: it must be the four-colour "G" on white, never recoloured or
 * flattened. Facebook's is the white glyph on its blue disc.
 *
 * A sign-in button without the provider's mark makes people hesitate; the logo
 * is what tells them at a glance that this is the real thing and not a form
 * asking for their Google password.
 */
export function AuthProviderIcon({ provider, size = 20 }: { provider: 'google' | 'facebook'; size?: number }) {
  if (provider === 'google') {
    return (
      <Svg width={size} height={size} viewBox="0 0 48 48">
        <Path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
        <Path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
        <Path fill="#FBBC05" d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
        <Path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="12" fill="#1877F2" />
      <Path
        d="M16.7 15.5 17.2 12h-3.4V9.7c0-1 .5-1.9 2-1.9h1.5V4.8s-1.4-.2-2.7-.2c-2.7 0-4.5 1.7-4.5 4.7V12H6.9v3.5h3.2V24a12 12 0 0 0 3.7 0v-8.5z"
        fill="#FFFFFF"
      />
    </Svg>
  );
}

/** Single-path silhouettes, for lists where brand colour would be noise. */
const MONO_PATHS: Record<PlatformId, string> = {
  youtube:   'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4L15.8 12z',
  facebook:  'M24 12a12 12 0 1 0-13.9 11.9v-8.4H7.1V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12z',
  instagram: 'M12 2.2c3.2 0 3.6 0 4.9.1 3.3.1 4.8 1.7 4.9 4.9.1 1.3.1 1.7.1 4.8s0 3.6-.1 4.9c-.1 3.2-1.6 4.8-4.9 4.9-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-3.3-.2-4.8-1.7-4.9-4.9-.1-1.3-.1-1.7-.1-4.9s0-3.5.1-4.8C2.3 4 3.8 2.4 7.1 2.3c1.3-.1 1.7-.1 4.9-.1zM12 0C8.7 0 8.3 0 7 .1 2.7.3.3 2.7.1 7 0 8.3 0 8.7 0 12s0 3.7.1 5c.2 4.4 2.6 6.8 6.9 7 1.3.1 1.7.1 5 .1s3.7 0 5-.1c4.4-.2 6.8-2.6 7-7 .1-1.3.1-1.7.1-5s0-3.7-.1-5c-.2-4.4-2.6-6.8-6.9-7C15.7 0 15.3 0 12 0zm0 5.8a6.2 6.2 0 1 0 0 12.4A6.2 6.2 0 0 0 12 5.8zm0 10.2a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.8a1.44 1.44 0 1 0 0 2.9 1.44 1.44 0 0 0 0-2.9z',
  tiktok:    'M16.9 5.6a4.9 4.9 0 0 1-1.1-2.9h-3.2v12.3a2.5 2.5 0 1 1-1.8-2.4V9.3a5.7 5.7 0 1 0 4.9 5.6V9.2a8 8 0 0 0 4.5 1.4V7.4a4.8 4.8 0 0 1-3.3-1.8z',
  twitch:    'M4.3 2 2.5 6.6v15.1h5.2V24h2.9l2.3-2.3h4.2l5.6-5.6V2zm16.3 13.2-3.2 3.2h-5.2l-2.8 2.8v-2.8H5.9V3.9h14.7z',
  twitter:   'M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.66l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.83l4.71 6.23z',
  linkedin:  'M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z',
  kick:      'M3 3h5.3v5.3h2.7V5.7h2.6V3H19v7.9h-2.6v2.2H19V21h-5.4v-2.7h-2.6v-2.6H8.3V21H3z',
};
