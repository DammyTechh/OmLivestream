import React, { useRef } from 'react';
import {
  Animated, View, StyleSheet, Platform, RefreshControl,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme, isIOS } from '@/hooks/useTheme';
import { space, type as typo } from '@/constants/theme';
import { Txt } from './ui';

/**
 * The page shell: safe areas, scrolling, and the header.
 *
 * The header is the part worth explaining. On iOS it is a *material*, not a
 * bar — transparent while the content is at rest, and as the user scrolls it
 * fades in a blur that the content passes beneath. That is the behaviour of
 * Mail, Settings and Music, and it is what makes an app feel like it belongs
 * on the platform rather than having been ported to it.
 *
 * The title does the same thing native large titles do: it starts large in the
 * content, and as it scrolls away a compact copy fades into the bar, so the
 * user is never unsure which screen they are on.
 *
 * Android gets a solid surface with a hairline instead. Frosted glass is not
 * Material idiom, and a blur there reads as an iOS app wearing the wrong
 * clothes — the same mistake in the other direction.
 */

const HEADER_HEIGHT = 52;
/** Scroll distance over which the bar resolves. Short enough to feel immediate. */
const FADE_DISTANCE = 60;

export function Screen({
  title,
  subtitle,
  right,
  aboveTitle,
  children,
  scrollable = true,
  refreshing,
  onRefresh,
  contentStyle,
  largeTitle = true,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  /** Rendered above the large title — used for the brand lockup on Home. */
  aboveTitle?: React.ReactNode;
  children: React.ReactNode;
  scrollable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  contentStyle?: StyleProp<ViewStyle>;
  largeTitle?: boolean;
}) {
  const { t, isDark, gutter, maxContentWidth } = useTheme();
  const insets = useSafeAreaInsets();
  const scrollY = useRef(new Animated.Value(0)).current;

  // Driven natively so the header keeps up with the finger even while JS is
  // busy rendering a list — the difference between "smooth" and "cheap".
  const barOpacity = scrollY.interpolate({
    inputRange: [0, FADE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const compactTitleOpacity = scrollY.interpolate({
    inputRange: [FADE_DISTANCE * 0.5, FADE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const body = (
    <View style={[{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center' }, contentStyle]}>
      {largeTitle && title && (
        <View style={{ paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: space.lg }}>
          {aboveTitle && <View style={{ marginBottom: space.lg }}>{aboveTitle}</View>}
          <Txt variant="display">{title}</Txt>
          {subtitle && (
            <Txt variant="small" muted style={{ marginTop: 6 }}>{subtitle}</Txt>
          )}
        </View>
      )}
      {children}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* ── Header ───────────────────────────────────────────────── */}
      <View style={[styles.header, { paddingTop: insets.top, height: HEADER_HEIGHT + insets.top }]}>
        {/* The material itself, revealed by scroll. pointerEvents none so it
            never intercepts a tap meant for the content beneath. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: barOpacity }]} pointerEvents="none">
          {isIOS ? (
            <BlurView
              intensity={70}
              tint={isDark ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }]} />
          )}
          <View style={[styles.hairline, { backgroundColor: t.border }]} />
        </Animated.View>

        <View style={[styles.headerRow, { paddingHorizontal: gutter }]}>
          <Animated.View style={{ opacity: largeTitle ? compactTitleOpacity : 1, flex: 1 }}>
            <Txt variant="h3" numberOfLines={1}>{title}</Txt>
          </Animated.View>
          {right}
        </View>
      </View>

      {/* ── Content ──────────────────────────────────────────────── */}
      {scrollable ? (
        <Animated.ScrollView
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], {
            useNativeDriver: true,
          })}
          scrollEventThrottle={16}
          contentContainerStyle={{
            paddingTop: HEADER_HEIGHT + insets.top,
            // Clears the tab bar plus the home indicator, so the last row is
            // never half-hidden behind it.
            paddingBottom: insets.bottom + space['5xl'],
          }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          refreshControl={
            onRefresh
              ? <RefreshControl
                  refreshing={!!refreshing}
                  onRefresh={onRefresh}
                  tintColor={t.textMuted}
                  progressViewOffset={HEADER_HEIGHT + insets.top}
                />
              : undefined
          }
        >
          {body}
        </Animated.ScrollView>
      ) : (
        <View style={{ flex: 1, paddingTop: HEADER_HEIGHT + insets.top }}>{body}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: 10,
    justifyContent: 'flex-end',
  },
  headerRow: {
    height: HEADER_HEIGHT,
    flexDirection: 'row', alignItems: 'center', gap: space.md,
  },
  hairline: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: StyleSheet.hairlineWidth,
  },
});

export { HEADER_HEIGHT };
