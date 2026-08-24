import React, { useEffect, useRef, useState } from 'react';
import {
  View, KeyboardAvoidingView, Platform, ScrollView, Alert, Pressable, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, unwrap } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { Button, Txt, Field, Divider } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { AuthProviderIcon } from '@/components/PlatformIcon';
import { Logo } from '@/components/Logo';

type Provider = { id: 'google' | 'facebook'; label: string };

/**
 * Sign-in.
 *
 * Two steps rather than one screen with everything on it: enter an email, then
 * enter the code. Asking for one thing at a time is what keeps a first
 * impression calm, and it means the code step can own the whole screen —
 * autofill, resend timer, and a clear way back.
 *
 * The provider list comes from the API rather than being hard-coded. The
 * server already decides which providers it can actually serve (Instagram was
 * removed when Meta shut down the API behind it), and a button that opens a
 * provider error page is worse than no button.
 */
export default function SignInScreen() {
  const { t, gutter } = useTheme();
  const insets = useSafeAreaInsets();
  const { sendOtp, verifyOtp, signInWithProvider, loading } = useAuth();

  /**
   * Sign in and sign up are the same mechanism — a code to an email address
   * either matches an account or creates one — but they are not the same
   * *intention*, and a screen that only says "Sign in" reads as closed to
   * someone who has never heard of the product. The website offers both, so
   * this does too. The mode changes the words, not the request.
   */
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.get('/auth/social/providers')
      .then((r) => setProviders(unwrap<Provider[]>(r)))
      .catch(() => setProviders([])); // email still works; just no buttons
  }, []);

  // Resend cooldown. Without it people tap repeatedly, trip the rate limit,
  // and then genuinely cannot sign in for a while.
  useEffect(() => {
    if (cooldown <= 0) return;
    timer.current = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [cooldown]);

  const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const handleSendCode = async () => {
    setError(null);
    if (!emailLooksValid) { setError('Enter a valid email address.'); return; }
    try {
      await sendOtp(email);
      setStep('code');
      setCooldown(30);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleVerify = async () => {
    setError(null);
    if (code.trim().length !== 6) { setError('Enter the 6-digit code.'); return; }
    try {
      await verifyOtp(email, code);
      // Navigation is driven by auth state in RootNavigator; nothing to do.
    } catch (e) {
      setError((e as Error).message);
      setCode('');
    }
  };

  const handleProvider = async (id: 'google' | 'facebook') => {
    setError(null);
    setBusyProvider(id);
    try {
      await signInWithProvider(id);
    } catch (e) {
      const msg = (e as Error).message;
      // Cancelling is a choice, not a failure — don't shout about it.
      if (!/cancel/i.test(msg)) Alert.alert('Could not sign in', msg);
    } finally {
      setBusyProvider(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: t.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: gutter,
          paddingTop: insets.top + space['3xl'],
          paddingBottom: insets.bottom + space['3xl'],
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={{ alignItems: 'center', marginBottom: space['3xl'] }}>
          <Logo size={38} />
        </View>

        {step === 'email' ? (
          <>
            <Txt variant="h1" style={{ textAlign: 'center' }}>
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </Txt>
            <Txt variant="small" muted style={{ textAlign: 'center', marginTop: 6, marginBottom: space['2xl'] }}>
              {mode === 'signup'
                ? 'Go live to every platform at once.'
                : 'Sign in to keep streaming.'}
            </Txt>

            <Field
              label="Email"
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={handleSendCode}
              error={error}
            />

            <Button
              title={mode === 'signup' ? 'Create account with email' : 'Continue with email'}
              onPress={handleSendCode}
              loading={loading}
              disabled={!emailLooksValid}
              fullWidth
              size="lg"
              style={{ marginTop: space.lg }}
            />

            {/* The way in for someone who has never used OmliveStream. Without
                it the screen only ever says "sign in", and a new visitor
                assumes they need an account from somewhere else first. */}
            <Pressable
              onPress={() => { setMode((m) => (m === 'signin' ? 'signup' : 'signin')); setError(null); }}
              style={{ marginTop: space.lg, alignSelf: 'center', paddingVertical: space.sm }}
              hitSlop={8}
            >
              <Txt variant="small" muted>
                {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                <Txt variant="small" color={t.primary}>
                  {mode === 'signin' ? 'Create one' : 'Sign in'}
                </Txt>
              </Txt>
            </Pressable>

            {providers.length > 0 && (
              <>
                <View style={styles.orRow}>
                  <View style={{ flex: 1 }}><Divider /></View>
                  <Txt variant="small" muted>or</Txt>
                  <View style={{ flex: 1 }}><Divider /></View>
                </View>

                <View style={{ gap: space.md }}>
                  {providers.map((p) => (
                    <Button
                      key={p.id}
                      title={`${mode === 'signup' ? 'Sign up' : 'Continue'} with ${p.label}`}
                      variant="secondary"
                      size="lg"
                      fullWidth
                      icon={<AuthProviderIcon provider={p.id} size={19} />}
                      loading={busyProvider === p.id}
                      disabled={busyProvider !== null}
                      onPress={() => handleProvider(p.id)}
                    />
                  ))}
                </View>
              </>
            )}

            <Txt variant="small" muted style={{ textAlign: 'center', marginTop: space['2xl'], lineHeight: 19 }}>
              By continuing you agree to our Terms and Privacy Policy.
            </Txt>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => { setStep('email'); setCode(''); setError(null); }}
              style={styles.back}
              hitSlop={12}
            >
              <Icon name="chevronLeft" size={18} />
              <Txt variant="small" muted>Back</Txt>
            </Pressable>

            <Txt variant="h1" style={{ textAlign: 'center' }}>Check your email</Txt>
            <Txt variant="small" muted style={{ textAlign: 'center', marginTop: 6, marginBottom: space['2xl'] }}>
              We sent a 6-digit code to {email}
            </Txt>

            <Field
              label="Code"
              value={code}
              onChangeText={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 6);
                setCode(digits);
                setError(null);
                // Submit as soon as it's complete. On iOS the code arrives via
                // keyboard autofill, so this often means zero taps.
                if (digits.length === 6) setTimeout(() => void handleVerify(), 80);
              }}
              placeholder="000000"
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              autoFocus
              maxLength={6}
              error={error}
              style={{ fontSize: 26, letterSpacing: 10, textAlign: 'center', fontWeight: '600' }}
            />

            <Button
              title="Verify and continue"
              onPress={handleVerify}
              loading={loading}
              disabled={code.length !== 6}
              fullWidth
              size="lg"
              style={{ marginTop: space.lg }}
            />

            <Button
              title={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              variant="ghost"
              disabled={cooldown > 0}
              onPress={handleSendCode}
              fullWidth
              style={{ marginTop: space.sm }}
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  orRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space['2xl'] },
  back:  { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: space.lg, alignSelf: 'flex-start' },
});
