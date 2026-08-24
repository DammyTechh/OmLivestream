import React from 'react';
import {
  ActivityIndicator, Pressable, Text, TextInput, View, StyleSheet,
  type PressableProps, type TextInputProps, type ViewProps, type StyleProp,
  type ViewStyle, type TextStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme, isIOS } from '@/hooks/useTheme';
import { radius, space, type as typo, shadow, MIN_TOUCH } from '@/constants/theme';

/**
 * The primitives every screen is built from.
 *
 * Centralising them is what keeps the app looking like one product: a button
 * cannot drift, a card cannot acquire a slightly different radius on one
 * screen. It is also where the platform manners live — press feedback,
 * haptics, hit targets — so no screen has to remember them.
 */

// ── Text ────────────────────────────────────────────────────────────

type Variant = keyof typeof typo;

export function Txt({
  variant = 'body', muted, color, style, children, ...rest
}: {
  variant?: Variant;
  muted?: boolean;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: React.ReactNode;
} & React.ComponentProps<typeof Text>) {
  const { t } = useTheme();
  return (
    <Text
      style={[typo[variant] as TextStyle, { color: color ?? (muted ? t.textMuted : t.text) }, style]}
      // Cap OS text scaling. Honouring it entirely is correct for a reading
      // app; here, an unbounded multiplier breaks the live controls a creator
      // needs mid-broadcast, so it is allowed to grow but not without limit.
      maxFontSizeMultiplier={1.4}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ── Button ──────────────────────────────────────────────────────────

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type BtnSize = 'sm' | 'md' | 'lg';

export function Button({
  title, onPress, variant = 'primary', size = 'md',
  loading, disabled, icon, fullWidth, style, ...rest
}: {
  title: string;
  variant?: BtnVariant;
  size?: BtnSize;
  loading?: boolean;
  icon?: React.ReactNode;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
} & Omit<PressableProps, 'style'>) {
  const { t } = useTheme();
  const isDisabled = disabled || loading;

  const heights = { sm: 38, md: MIN_TOUCH, lg: 54 };
  const pads    = { sm: space.md, md: space.lg, lg: space.xl };
  const fonts   = { sm: 14, md: 15, lg: 16 };

  const bg: Record<BtnVariant, string> = {
    primary:   t.primary,
    secondary: t.surfaceAlt,
    ghost:     'transparent',
    danger:    t.live,
  };
  const fg: Record<BtnVariant, string> = {
    primary: '#FFFFFF', secondary: t.text, ghost: t.textMuted, danger: '#FFFFFF',
  };

  return (
    <Pressable
      onPress={(e) => {
        if (isDisabled) return;
        // A light tap on confirm-style actions. iOS users read this as
        // responsiveness; without it, a flat button feels unacknowledged.
        if (isIOS && variant !== 'ghost') {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        onPress?.(e);
      }}
      disabled={isDisabled}
      // Opacity on press rather than a colour swap: it reads identically in
      // both themes and needs no extra tokens.
      style={({ pressed }) => [
        styles.btn,
        {
          height: heights[size],
          paddingHorizontal: pads[size],
          borderRadius: radius.md,
          backgroundColor: bg[variant],
          opacity: isDisabled ? 0.45 : pressed ? 0.82 : 1,
          borderWidth: variant === 'secondary' ? StyleSheet.hairlineWidth : 0,
          borderColor: t.border,
          alignSelf: fullWidth ? 'stretch' : 'auto',
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      accessibilityLabel={title}
      {...rest}
    >
      {loading
        ? <ActivityIndicator color={fg[variant]} size="small" />
        : (
          <View style={styles.btnRow}>
            {icon}
            <Text
              style={{ color: fg[variant], fontSize: fonts[size], fontWeight: '600' }}
              numberOfLines={1}
              maxFontSizeMultiplier={1.2}
            >
              {title}
            </Text>
          </View>
        )}
    </Pressable>
  );
}

// ── Card ────────────────────────────────────────────────────────────

export function Card({ style, children, padded = true, ...rest }: ViewProps & { padded?: boolean }) {
  const { t } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: t.surface,
          borderRadius: radius.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: t.border,
          padding: padded ? space.lg : 0,
        },
        shadow(1),
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

// ── Input ───────────────────────────────────────────────────────────

export function Field({
  label, error, hint, style, ...rest
}: TextInputProps & { label?: string; error?: string | null; hint?: string }) {
  const { t } = useTheme();
  const [focused, setFocused] = React.useState(false);

  return (
    <View style={{ gap: space.sm }}>
      {label && <Txt variant="small" muted>{label}</Txt>}
      <TextInput
        placeholderTextColor={t.textMuted}
        onFocus={(e) => { setFocused(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); rest.onBlur?.(e); }}
        style={[
          {
            minHeight: MIN_TOUCH,
            paddingHorizontal: space.lg,
            paddingVertical: space.md,
            borderRadius: radius.md,
            borderWidth: StyleSheet.hairlineWidth,
            // The focus ring is the only place a border changes colour. It is
            // how someone knows which field the keyboard is typing into.
            borderColor: error ? t.live : focused ? t.primary : t.border,
            backgroundColor: t.surfaceAlt,
            color: t.text,
            fontSize: 16, // 16 or iOS zooms the viewport on focus
          },
          style,
        ]}
        {...rest}
      />
      {(error || hint) && (
        <Txt variant="small" color={error ? t.live : t.textMuted}>{error ?? hint}</Txt>
      )}
    </View>
  );
}

// ── Badge ───────────────────────────────────────────────────────────

export function Badge({
  label, tone = 'neutral', dot,
}: { label: string; tone?: 'neutral' | 'live' | 'success' | 'brand'; dot?: boolean }) {
  const { t } = useTheme();
  const tones = {
    neutral: { bg: t.surfaceAlt, fg: t.textMuted },
    live:    { bg: 'rgba(229,72,77,0.14)', fg: t.live },
    success: { bg: 'rgba(16,185,129,0.14)', fg: t.success },
    brand:   { bg: t.primarySoft, fg: t.primary },
  }[tone];

  return (
    <View style={[styles.badge, { backgroundColor: tones.bg }]}>
      {dot && <View style={[styles.dot, { backgroundColor: tones.fg }]} />}
      <Text style={[typo.caption as TextStyle, { color: tones.fg, textTransform: 'uppercase' }]}>
        {label}
      </Text>
    </View>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

export function EmptyState({
  title, message, action,
}: { title: string; message: string; action?: React.ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space['4xl'], gap: space.sm }}>
      <Txt variant="h3">{title}</Txt>
      <Txt variant="small" muted style={{ textAlign: 'center', maxWidth: 300 }}>{message}</Txt>
      {action && <View style={{ marginTop: space.md }}>{action}</View>}
    </View>
  );
}

// ── Divider ─────────────────────────────────────────────────────────

export function Divider() {
  const { t } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

const styles = StyleSheet.create({
  btn:    { alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  badge:  {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
