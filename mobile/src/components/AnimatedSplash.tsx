import React, { useEffect } from 'react';
import { View, Image, StyleSheet, useWindowDimensions } from 'react-native';
import Svg, { Path, Circle, Defs, LinearGradient, Stop, RadialGradient } from 'react-native-svg';
import Animated, {
  useSharedValue, useAnimatedStyle, withTiming, withRepeat,
  withSequence, withDelay, Easing, runOnJS,
} from 'react-native-reanimated';
import { useTheme } from '@/hooks/useTheme';
import { Logo } from './Logo';

/**
 * The animated splash.
 *
 * The OS launch image is a still — it has to be, because it is shown before a
 * single line of our code runs. This component takes over the instant the app
 * mounts and continues from exactly that composition, so the handoff reads as
 * one continuous moment rather than two screens.
 *
 * The artwork is the landing page's hero background, rebuilt in SVG: the same
 * band of sweeping lines and the same soft violet glow. Someone who visited
 * the site and then opened the app should recognise it immediately, and it
 * costs nothing — it is a few dozen vector paths, not an image.
 *
 * The mark breathes rather than spins. A spinner says "waiting"; a slow scale
 * and glow says "alive", and at 2.6s per cycle it is barely above the
 * threshold of notice — which is the point. Anything faster reads as anxious,
 * and this is on screen for under a second in the normal case.
 */

const WAVE_COUNT = 22;
const WAVE_GAP   = 41;
const BREATH_MS  = 1300;   // one half-cycle: in, then out

export function AnimatedSplash({
  visible,
  onFinished,
}: {
  /** Flip to false once the app is ready; the splash fades itself out. */
  visible: boolean;
  /** Fired after the fade completes, so the host can unmount it. */
  onFinished?: () => void;
}) {
  const { t, isDark } = useTheme();
  const { width, height } = useWindowDimensions();

  const breath  = useSharedValue(0);   // 0 → 1 → 0, drives scale and glow
  const enter   = useSharedValue(0);   // one-shot fade/scale in
  const exitOp  = useSharedValue(1);   // fade the whole splash away

  useEffect(() => {
    // Enter: the mark settles into place rather than popping.
    enter.value = withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) });

    // Breathe, indefinitely. `-1` repeats forever; `true` reverses each cycle
    // so the motion is a genuine in-out rather than a sawtooth reset.
    breath.value = withDelay(
      260,
      withRepeat(
        withTiming(1, { duration: BREATH_MS, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
  }, [breath, enter]);

  /**
   * Driven by the `visible` prop rather than an imperative handle.
   *
   * The alternative — hanging a `dismiss()` off the component — works but ties
   * the parent to a mutable side-channel that React can re-create at any time.
   * A prop is declarative, survives fast refresh, and makes the exit
   * animation's completion the only thing that unmounts it, so the fade can
   * never be cut off mid-way.
   */
  useEffect(() => {
    if (visible) return;
    exitOp.value = withTiming(
      0,
      { duration: 340, easing: Easing.out(Easing.quad) },
      (finished) => {
        if (finished && onFinished) runOnJS(onFinished)();
      },
    );
  }, [visible, exitOp, onFinished]);

  const markStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      // 1.00 → 1.055. Small on purpose: a logo that visibly pulses looks like
      // it is loading badly. This should be felt more than seen.
      { scale: (0.94 + enter.value * 0.06) * (1 + breath.value * 0.055) },
    ],
  }));

  // The halo swells slightly ahead of the mark, which is what makes it read as
  // light coming off the object rather than the object simply resizing.
  const haloStyle = useAnimatedStyle(() => ({
    opacity: (isDark ? 0.34 : 0.20) * (0.55 + breath.value * 0.45) * enter.value,
    transform: [{ scale: 1 + breath.value * 0.14 }],
  }));

  const rootStyle = useAnimatedStyle(() => ({ opacity: exitOp.value }));

  const markSize = Math.min(width, height) * 0.26;
  const glowA = isDark ? '#7C3AED' : '#A855F7';
  const glowB = isDark ? '#4C1D95' : '#C4B5FD';

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { backgroundColor: t.bg }, rootStyle]}
      pointerEvents="none"
    >
      {/* ── Hero artwork ───────────────────────────────────────── */}
      <Svg
        width={width}
        height={height}
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        style={StyleSheet.absoluteFill}
      >
        <Defs>
          <LinearGradient id="wave" x1="0%" y1="100%" x2="100%" y2="0%">
            <Stop offset="0%"   stopColor={glowA} stopOpacity={isDark ? 0.55 : 0.30} />
            <Stop offset="50%"  stopColor={glowB} stopOpacity={isDark ? 0.35 : 0.20} />
            <Stop offset="100%" stopColor={glowA} stopOpacity={isDark ? 0.55 : 0.30} />
          </LinearGradient>
          <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
            <Stop offset="0%"  stopColor={glowA} stopOpacity={isDark ? 0.30 : 0.16} />
            <Stop offset="55%" stopColor={glowB} stopOpacity={isDark ? 0.12 : 0.07} />
            <Stop offset="100%" stopColor={glowA} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {/* The ambient wash the hero sits in. */}
        <Circle cx="440" cy="380" r="620" fill="url(#glow)" />

        {/* The same sweeping band as the website, drawn with the same
            quadratic-then-smooth curve and the same 41px spacing. */}
        {Array.from({ length: WAVE_COUNT }).map((_, i) => {
          const o = i * WAVE_GAP;
          return (
            <Path
              key={i}
              d={`M ${-200 - o} ${900 + o / 2}
                  Q ${300 - o / 3} ${600 - o * 0.7}, ${700 - o / 4} ${700 - o * 0.5}
                  T 1500 ${400 - o * 0.6}`}
              fill="none"
              stroke="url(#wave)"
              strokeWidth={1}
              opacity={Math.max(0.05, 0.7 - i * 0.028)}
            />
          );
        })}
      </Svg>

      {/* ── Mark ───────────────────────────────────────────────── */}
      <View style={styles.center}>
        <Animated.View
          style={[
            styles.halo,
            {
              width: markSize * 2.1,
              height: markSize * 2.1,
              borderRadius: markSize * 1.05,
              backgroundColor: glowA,
            },
            haloStyle,
          ]}
        />
        {/* Mark + wordmark, matching the still the OS showed a moment ago.
            Showing a different composition here makes the handoff visibly
            jump, which is the one thing this whole two-stage dance exists to
            avoid. The two breathe together as one lockup. */}
        <Animated.View style={[markStyle, { alignItems: 'center' }]}>
          <Image
            source={require('../../assets/logo-mark.png')}
            style={{ width: markSize, height: markSize }}
            resizeMode="contain"
          />
          <View style={{ marginTop: markSize * 0.16 }}>
            <Logo size={markSize * 0.30} showWordmark onDark={isDark} showMark={false} />
          </View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    // A blurred halo would be ideal, but a real blur on a full-screen layer is
    // expensive on Android at launch — the one moment where a dropped frame is
    // most visible. A low-opacity disc reads almost identically at this scale.
    opacity: 0.3,
  },
});
