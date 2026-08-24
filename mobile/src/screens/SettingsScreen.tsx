import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { api, getApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { entitlements } from '@/constants/entitlements';
import { Screen } from '@/components/Screen';
import { Card, Txt, Badge, Button, Divider } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';

const SITE = (Constants.expoConfig?.extra?.siteUrl as string) ?? 'https://www.omlivestream.com';

/**
 * Account and app settings.
 *
 * Grouped by consequence: identity first, then plan, then the app itself, then
 * the destructive actions last and visually separated. Account deletion sits
 * at the bottom behind a confirmation because it is irreversible and cancels a
 * live subscription.
 */
export default function SettingsScreen() {
  const { t, gutter } = useTheme();
  const nav = useNavigation<any>();
  const { user, logout } = useAuth();
  const ent = entitlements(user?.plan);
  const [busy, setBusy] = useState(false);

  const Row = ({ icon, label, value, onPress, danger }: {
    icon: IconName; label: string; value?: string; onPress?: () => void; danger?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed && onPress ? 0.6 : 1 }]}
    >
      <Icon name={icon} size={19} color={danger ? t.live : t.textMuted} />
      <Txt variant="body" color={danger ? t.live : t.text} style={{ flex: 1 }}>{label}</Txt>
      {value && <Txt variant="small" muted numberOfLines={1} style={{ maxWidth: 160 }}>{value}</Txt>}
      {onPress && !danger && <Icon name="chevronRight" size={17} />}
    </Pressable>
  );

  const confirmLogout = () => {
    Alert.alert('Sign out?', 'You will need to sign in again to broadcast.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void logout() },
    ]);
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete your account?',
      'This removes your profile, connected platforms, recordings and analytics. '
      + 'It cancels your subscription and cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try { await api.delete('/users/me'); await logout(); }
            catch (err) { Alert.alert('Could not delete', getApiError(err)); }
            finally { setBusy(false); }
          },
        },
      ],
    );
  };

  return (
    <Screen title="Settings">
      <View style={{ paddingHorizontal: gutter, gap: space.lg }}>

        {/* Identity */}
        <Card style={{ gap: space.md }}>
          <View style={styles.row}>
            <View style={[styles.avatar, { backgroundColor: t.primarySoft }]}>
              <Txt variant="h2" color={t.primary}>
                {(user?.full_name ?? user?.email ?? '?').charAt(0).toUpperCase()}
              </Txt>
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <Txt variant="h3" numberOfLines={1}>{user?.full_name ?? 'Your account'}</Txt>
              <Txt variant="small" muted numberOfLines={1}>{user?.email}</Txt>
            </View>
          </View>
          <Badge
            label={user?.plan === 'premium' ? 'Premium' : user?.plan === 'free_trial' ? 'Free trial' : 'Free'}
            tone={user?.plan === 'premium' ? 'brand' : 'neutral'}
          />
        </Card>

        {/* Plan */}
        {user?.plan !== 'premium' && (
          <Card>
            <Txt variant="h3">Premium</Txt>
            <Txt variant="small" muted style={{ marginTop: 6, marginBottom: space.lg, lineHeight: 20 }}>
              All 8 platforms at once, comment replies across every platform,
              AI Studio, and camera switching while you stream.
            </Txt>
            {/* Checkout opens on the web deliberately: putting a payment sheet
                in the app would put this under the app stores' in-app purchase
                rules, which is a different (and much larger) conversation. */}
            <Button
              title="Upgrade on the web"
              variant="secondary"
              onPress={() => void Linking.openURL(`${SITE}/payment?plan=premium`)}
            />
          </Card>
        )}

        {/* Account */}
        <Card padded={false}>
          <Row icon="user"  label="Plan" value={`${ent.maxPlatforms} platform${ent.maxPlatforms > 1 ? 's' : ''}`} />
          <Divider />
          <Row icon="video" label="Recordings" onPress={() => nav.navigate('Recordings')} />
          <Divider />
          <Row icon="link"  label="Platforms" onPress={() => nav.navigate('Platforms')} />
        </Card>

        {/* App */}
        <Card padded={false}>
          <Row icon="alert" label="Privacy Policy" onPress={() => void Linking.openURL(`${SITE}/privacy`)} />
          <Divider />
          <Row icon="alert" label="Terms of Service" onPress={() => void Linking.openURL(`${SITE}/terms`)} />
          <Divider />
          <Row icon="alert" label="Delete my data" onPress={() => void Linking.openURL(`${SITE}/data-deletion`)} />
        </Card>

        {/* Destructive, separated */}
        <Card padded={false}>
          <Row icon="logout" label="Sign out" onPress={confirmLogout} />
          <Divider />
          <Row icon="close" label="Delete account" onPress={confirmDelete} danger />
        </Card>

        <Txt variant="small" muted style={{ textAlign: 'center' }}>
          OmliveStream v{Constants.expoConfig?.version ?? '1.0.0'}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
});
