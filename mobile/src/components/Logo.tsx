import React from 'react';
import { View, Image } from 'react-native';
import { useTheme } from '@/hooks/useTheme';
import { Txt } from './ui';

/**
 * The brand lockup: the real OmliveStream orb plus the wordmark.
 *
 * The mark is the actual artwork from the website (`logo-mark.png`), not a
 * redrawn approximation. An earlier version of this file drew a simplified
 * violet circle with a play triangle — clean, but not the OmliveStream logo,
 * and a brand that differs between web and app is not one brand. Bundled
 * locally rather than fetched, so it renders instantly at launch and cannot
 * fail on a bad connection.
 *
 * The wordmark stays live text so it follows the theme: dark ink on the light
 * appearance, white on dark. Baking it into the image is exactly what made the
 * web logo illegible on light backgrounds. `onDark` pins it white for surfaces
 * that stay dark whatever the theme — a camera preview, a live overlay.
 */
export function Logo({
  size = 30,
  onDark = false,
  showWordmark = true,
  showMark = true,
}: {
  size?: number;
  onDark?: boolean;
  showWordmark?: boolean;
  /** Text only — for places that draw the orb themselves at a different scale. */
  showMark?: boolean;
}) {
  const { t } = useTheme();

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: size * 0.26 }}>
      {showMark && (
        <Image
          source={require('../../assets/logo-mark.png')}
          style={{ width: size, height: size }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      )}
      {showWordmark && (
        <Txt
          variant="h2"
          color={onDark ? '#FFFFFF' : t.text}
          numberOfLines={1}
          /* The lockup fits every device from a 320pt SE upward, but OS font
             scaling can still push it wider than the screen. Capping the
             multiplier keeps the brand on one line instead of wrapping
             "Stream" onto a second row. */
          maxFontSizeMultiplier={1.1}
          style={{ fontSize: size * 0.60, letterSpacing: -0.4 }}
        >
          Omlive
          <Txt
            variant="h2"
            color={onDark ? 'rgba(255,255,255,0.78)' : t.primary}
            style={{ fontSize: size * 0.60, letterSpacing: -0.4 }}
          >
            Stream
          </Txt>
        </Txt>
      )}
    </View>
  );
}
