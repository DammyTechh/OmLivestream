import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '@/hooks/useTheme';
import { Txt } from './ui';

/**
 * The brand lockup: mark plus wordmark.
 *
 * The mark is drawn, not bundled as an image. On the website the equivalent
 * asset broke on every subdomain because a rewrite mangled its path — a class
 * of failure a vector drawn in code simply cannot have. It also stays crisp on
 * any density without shipping @2x and @3x variants.
 *
 * The wordmark is live text in the theme's ink colour, so it is legible in
 * both appearances. `onDark` pins it to white for surfaces that stay dark
 * whatever the theme — a camera preview, a live overlay.
 */
export function Logo({ size = 30, onDark = false }: { size?: number; onDark?: boolean }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Svg width={size} height={size} viewBox="0 0 40 40">
        <Circle cx="20" cy="20" r="19" fill={t.primary} />
        {/* Optically centred: a geometric centre reads left-heavy on a triangle. */}
        <Path d="M16.5 13.2 L28 20 L16.5 26.8 Z" fill="#FFFFFF" />
      </Svg>
      <Txt
        variant="h2"
        color={onDark ? '#FFFFFF' : t.text}
        style={{ fontSize: size * 0.62, letterSpacing: -0.4 }}
      >
        Omlive
        <Txt
          variant="h2"
          color={onDark ? 'rgba(255,255,255,0.75)' : t.primary}
          style={{ fontSize: size * 0.62, letterSpacing: -0.4 }}
        >
          Stream
        </Txt>
      </Txt>
    </View>
  );
}
