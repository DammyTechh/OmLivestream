import React, { useState } from 'react';
import {
  View, Pressable, StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { api, getApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme, isIOS } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { Txt, Button, Field } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { Logo } from '@/components/Logo';

/**
 * Onboarding for accounts created in the app.
 *
 * Until now the app could only sign people *in* — `isNewUser` came back from
 * the API and was thrown away, so somebody who discovered OmliveStream through
 * the app landed on an empty dashboard with no name, no profile and no
 * platforms, and nothing ever asked them for any of it.
 *
 * The questions are the same three steps as the website, hitting the same two
 * endpoints, so an account started on a phone is indistinguishable from one
 * started on a laptop. Deliberately not "mobile-lite": a shorter survey would
 * mean two populations of users with different data, which quietly breaks
 * every report built on it.
 *
 * Step 3 (connecting a platform) is skippable on purpose. Asking someone to
 * authorise YouTube before they have seen the product is the single most
 * common place a sign-up is abandoned.
 */

const HEARD_FROM = [
  { value: 'social_media',    label: 'Social media'    },
  { value: 'friend_referral', label: 'A friend'        },
  { value: 'google_search',   label: 'Google search'   },
  { value: 'content_creator', label: 'Content creator' },
  { value: 'youtube_ad',      label: 'YouTube ad'      },
  { value: 'other',           label: 'Other'           },
] as const;

const USE_CASES = [
  { value: 'entertainment',     label: 'Entertainment'       },
  { value: 'gaming',            label: 'Gaming'              },
  { value: 'music_performance', label: 'Music & DJ sets'     },
  { value: 'education',         label: 'Tutorials & courses' },
  { value: 'business_brand',    label: 'Business / brand'    },
  { value: 'fitness_wellness',  label: 'Fitness & wellness'  },
  { value: 'events_concerts',   label: 'Events & concerts'   },
  { value: 'news_commentary',   label: 'News & commentary'   },
] as const;

export default function OnboardingScreen() {
  const { t, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — profile
  const [fullName, setFullName] = useState(user?.full_name ?? '');
  const [dob, setDob] = useState('');
  const [location, setLocation] = useState('');

  // Step 2 — survey
  const [heardFrom, setHeardFrom] = useState<string[]>([]);
  const [useCase, setUseCase] = useState<string[]>([]);

  const toggle = (list: string[], set: (v: string[]) => void, value: string) => {
    if (isIOS) void Haptics.selectionAsync();
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  /** YYYY-MM-DD, and old enough. The API enforces 13+; catching it here saves a round trip. */
  const dobValid = (() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
    const d = new Date(dob);
    if (Number.isNaN(d.getTime())) return false;
    const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
    return age >= 13 && age < 120;
  })();

  const saveProfile = async () => {
    setError(null);
    if (fullName.trim().length < 2) return setError('Please enter your full name.');
    if (!dobValid) return setError('Enter your date of birth as YYYY-MM-DD. You must be 13 or older.');
    if (!location.trim()) return setError('Please enter your location.');

    setSaving(true);
    try {
      await api.post('/users/onboarding/profile', {
        full_name: fullName.trim(),
        dob,
        location: location.trim(),
      });
      setStep(1);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const saveSurvey = async () => {
    setError(null);
    if (heardFrom.length === 0) return setError('Pick at least one option.');
    if (useCase.length === 0) return setError('Tell us what you will use it for.');

    setSaving(true);
    try {
      await api.post('/users/onboarding/survey', { heard_from: heardFrom, use_case: useCase });
      setStep(2);
    } catch (err) {
      setError(getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Finish. Refreshing the profile is what actually ends onboarding — the
   * navigator watches `onboarding_completed`, so the app moves on by itself
   * rather than this screen navigating imperatively.
   */
  const finish = async () => {
    setSaving(true);
    await refreshProfile();
    setSaving(false);
  };

  const Chip = ({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primarySoft : 'transparent' },
      ]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Txt variant="small" color={on ? t.primary : t.textMuted}>{label}</Txt>
      {on && <Icon name="check" size={13} color={t.primary} />}
    </Pressable>
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: gutter,
          paddingTop: insets.top + space['2xl'],
          paddingBottom: insets.bottom + space['3xl'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', marginBottom: space.xl }}>
          <Logo size={30} />
        </View>

        {/* Progress. Three dots, not a percentage — this is short, and a
            number invites the question "how much longer". */}
        <View style={styles.progress}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={{
                height: 3,
                flex: 1,
                borderRadius: 2,
                backgroundColor: i <= step ? t.primary : t.border,
              }}
            />
          ))}
        </View>

        {step === 0 && (
          <>
            <Txt variant="h1">Tell us about you</Txt>
            <Txt variant="small" muted style={{ marginTop: 6, marginBottom: space['2xl'] }}>
              A few details so we can personalise your account.
            </Txt>

            <View style={{ gap: space.lg }}>
              <Field
                label="Full name"
                value={fullName}
                onChangeText={setFullName}
                placeholder="Adebayo Okafor"
                autoCapitalize="words"
                autoComplete="name"
                textContentType="name"
              />
              <Field
                label="Date of birth"
                value={dob}
                onChangeText={setDob}
                placeholder="YYYY-MM-DD"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
                hint="Used for birthday greetings. You must be 13 or older."
              />
              <Field
                label="Location"
                value={location}
                onChangeText={setLocation}
                placeholder="Lagos, Nigeria"
                autoCapitalize="words"
              />
            </View>

            {error && <Txt variant="small" color={t.live} style={{ marginTop: space.md }}>{error}</Txt>}

            <Button
              title="Continue"
              size="lg"
              fullWidth
              loading={saving}
              onPress={saveProfile}
              style={{ marginTop: space['2xl'] }}
            />
          </>
        )}

        {step === 1 && (
          <>
            <Txt variant="h1">How did you find us?</Txt>
            <Txt variant="small" muted style={{ marginTop: 6, marginBottom: space.xl }}>
              Choose everything that applies.
            </Txt>

            <View style={styles.chips}>
              {HEARD_FROM.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  on={heardFrom.includes(o.value)}
                  onPress={() => toggle(heardFrom, setHeardFrom, o.value)}
                />
              ))}
            </View>

            <Txt variant="h2" style={{ marginTop: space['2xl'] }}>What will you stream?</Txt>
            <View style={[styles.chips, { marginTop: space.lg }]}>
              {USE_CASES.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  on={useCase.includes(o.value)}
                  onPress={() => toggle(useCase, setUseCase, o.value)}
                />
              ))}
            </View>

            {error && <Txt variant="small" color={t.live} style={{ marginTop: space.md }}>{error}</Txt>}

            <Button
              title="Continue"
              size="lg"
              fullWidth
              loading={saving}
              onPress={saveSurvey}
              style={{ marginTop: space['2xl'] }}
            />
          </>
        )}

        {step === 2 && (
          <>
            <Txt variant="h1">You&apos;re all set</Txt>
            <Txt variant="small" muted style={{ marginTop: 6, marginBottom: space['2xl'], lineHeight: 21 }}>
              Connect a platform whenever you&apos;re ready — you can do it now from
              Platforms, or later. Nothing else is needed to look around.
            </Txt>

            <View style={{ gap: space.md }}>
              {['Connect YouTube, Facebook, TikTok and more',
                'Go live to every platform at once',
                'Every broadcast recorded automatically'].map((line) => (
                <View key={line} style={styles.bullet}>
                  <Icon name="check" size={16} color={t.primary} />
                  <Txt variant="body" style={{ flex: 1 }}>{line}</Txt>
                </View>
              ))}
            </View>

            <Button
              title="Start using OmliveStream"
              size="lg"
              fullWidth
              loading={saving}
              onPress={finish}
              style={{ marginTop: space['3xl'] }}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 6, marginBottom: space['2xl'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.lg, paddingVertical: 10,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth,
  },
  bullet: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
