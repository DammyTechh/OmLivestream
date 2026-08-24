import React, { useState } from 'react';
import { Modal, View, Pressable, StyleSheet, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { api } from '@/api/client';
import { useTheme, isIOS } from '@/hooks/useTheme';
import { space, radius, MIN_TOUCH } from '@/constants/theme';
import { Txt, Button } from '@/components/ui';
import { Icon } from '@/components/Icon';

const ISSUES = [
  { id: 'video_quality',   label: 'Video quality' },
  { id: 'audio_quality',   label: 'Audio quality' },
  { id: 'dropped_frames',  label: 'Lag or dropped frames' },
  { id: 'platform_issue',  label: 'A platform failed' },
  { id: 'comments',        label: 'Comments' },
  { id: 'setup_confusing', label: 'Setup was confusing' },
] as const;

const WORDS = ['Bad', 'Poor', 'Okay', 'Good', 'Great'];

/**
 * Asked once, immediately after a broadcast ends.
 *
 * Same reasoning as the web version: timing is the whole point. Someone whose
 * stream dropped frames will say so in the thirty seconds after ending it and
 * never again, so it opens on its own rather than living behind a link nobody
 * taps.
 *
 * That is only acceptable because it is genuinely easy to dismiss, and because
 * a rating alone is a complete answer — the tags only appear when the rating
 * suggests something went wrong, so a happy creator taps once and is gone.
 *
 * Submission failures are swallowed. Feedback is a nice-to-have, and an error
 * here would read as though the broadcast itself had a problem.
 */
export function FeedbackSheet({
  streamId, reason, visible, onClose,
}: {
  streamId: string;
  reason: 'ended' | 'cancelled';
  visible: boolean;
  onClose: () => void;
}) {
  const { t, gutter } = useTheme();
  const insets = useSafeAreaInsets();

  const [rating, setRating] = useState(0);
  const [issues, setIssues] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) =>
    setIssues((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));

  const submit = async () => {
    if (!rating) return;
    setSaving(true);
    try {
      await api.post(`/streams/${streamId}/feedback`, {
        rating,
        issues,
        comment: comment.trim() || undefined,
        endedReason: reason,
      });
    } catch { /* deliberate — see note above */ }
    setSaving(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: t.overlay }]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ justifyContent: 'flex-end', flex: 1 }}
        >
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: t.surface,
                paddingHorizontal: gutter,
                paddingBottom: insets.bottom + space.xl,
                borderColor: t.border,
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: t.border }]} />

            <Pressable onPress={onClose} style={styles.close} hitSlop={12}>
              <Icon name="close" size={18} />
            </Pressable>

            <Txt variant="h2">
              {reason === 'cancelled' ? 'You cancelled that stream' : 'How did that go?'}
            </Txt>
            <Txt variant="small" muted style={{ marginTop: 6, lineHeight: 20 }}>
              {reason === 'cancelled'
                ? 'If something got in the way, telling us takes a few seconds.'
                : 'A quick rating helps us work out what to improve next.'}
            </Txt>

            {/* Stars */}
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Pressable
                  key={n}
                  onPress={() => {
                    if (isIOS) void Haptics.selectionAsync();
                    setRating(n);
                  }}
                  hitSlop={6}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: rating === n }}
                  accessibilityLabel={`${n} out of 5`}
                >
                  <Icon name="star" size={32} color={rating >= n ? t.primary : t.textMuted} strokeWidth={rating >= n ? 2 : 1.5} />
                </Pressable>
              ))}
              {rating > 0 && (
                <Txt variant="small" muted style={{ marginLeft: space.sm }}>{WORDS[rating - 1]}</Txt>
              )}
            </View>

            {/* Only worth asking once we know something went wrong. */}
            {rating > 0 && rating <= 3 && (
              <View style={{ gap: space.sm, marginTop: space.lg }}>
                <Txt variant="small" muted>What got in the way?</Txt>
                <View style={styles.chips}>
                  {ISSUES.map((o) => {
                    const on = issues.includes(o.id);
                    return (
                      <Pressable
                        key={o.id}
                        onPress={() => toggle(o.id)}
                        style={[
                          styles.chip,
                          { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primarySoft : 'transparent' },
                        ]}
                      >
                        <Txt variant="small" color={on ? t.primary : t.textMuted}>{o.label}</Txt>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}

            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Anything else? (optional)"
              placeholderTextColor={t.textMuted}
              multiline
              maxLength={2000}
              style={[
                styles.input,
                { borderColor: t.border, backgroundColor: t.surfaceAlt, color: t.text },
              ]}
            />

            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
              <Button title="Not now" variant="ghost" onPress={onClose} style={{ flex: 1 }} />
              <Button
                title="Send feedback"
                onPress={submit}
                loading={saving}
                disabled={!rating}
                style={{ flex: 1.4 }}
              />
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: space.md,
  },
  grabber: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.lg },
  close: { position: 'absolute', top: space.lg, right: space.lg, zIndex: 2 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xl },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingHorizontal: space.md, paddingVertical: 8,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
  input: {
    marginTop: space.lg, minHeight: 72,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
    padding: space.md, fontSize: 15, textAlignVertical: 'top',
  },
});
