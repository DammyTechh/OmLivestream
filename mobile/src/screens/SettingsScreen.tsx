import React, { useState } from 'react';
import { View, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
import { UpgradeSheet } from '@/components/UpgradeSheet';

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
  const { t, gutter, pref, setPref } = useTheme();
  const nav = useNavigation<any>();
  const { user, logout, setUser, refreshProfile } = useAuth();
  const ent = entitlements(user?.plan);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  /**
   * Change the profile picture.
   *
   * Cropped to a square before upload rather than after: every place this
   * appears is a circle, and letting someone pick the crop themselves avoids
   * the classic result where the automatic centre-crop cuts off their head.
   */
  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos access needed', 'Allow photo access to change your picture.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      // base64 is requested here because the API expects a data URL, not a
      // file upload — see below. 0.6 keeps a 1:1 avatar well under any body
      // limit while still looking sharp at 56pt.
      quality: 0.6,
      base64: true,
    });
    if (res.canceled || !res.assets?.[0]) return;

    setUploading(true);
    try {
      const asset = res.assets[0];
      if (!asset.base64) throw new Error('Could not read that image.');

      // POST /users/me/avatar takes `{ dataUrl }`, exactly as the website
      // sends it — verified against the web client rather than assumed. A
      // multipart upload here would fail with a validation error that reads
      // like a server fault.
      const dataUrl = `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
      const { url } = await api.post('/users/me/avatar', { dataUrl })
        .then((r) => r.data.data as { url: string });

      if (user) setUser({ ...user, avatar_url: url });
      await refreshProfile();
    } catch (err) {
      Alert.alert('Could not update your picture', getApiError(err));
    } finally {
      setUploading(false);
    }
  };

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
            {/* The account's actual picture when it has one — an initial is a
                placeholder, and showing it to someone who set an avatar years
                ago on the website reads as the wrong account. */}
            <Pressable onPress={pickAvatar} disabled={uploading}>
              {user?.avatar_url ? (
                <Image
                  source={{ uri: user.avatar_url }}
                  style={styles.avatar}
                  contentFit="cover"
                  transition={150}
                />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: t.primarySoft }]}>
                  <Txt variant="h2" color={t.primary}>
                    {(user?.full_name ?? user?.email ?? '?').charAt(0).toUpperCase()}
                  </Txt>
                </View>
              )}
              <View style={[styles.avatarBadge, { backgroundColor: t.primary, borderColor: t.surface }]}>
                <Icon name={uploading ? 'clock' : 'camera'} size={12} color="#FFFFFF" />
              </View>
            </Pressable>
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
            <Button
              title="See Premium"
              variant="secondary"
              onPress={() => setUpgradeOpen(true)}
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

        {/* Appearance.
        
            Light is the default, matching the website. 'System' is offered but
            not the default, because a phone with no preference set would open
            the app dark while omlivestream.com opened light — two faces of one
            product disagreeing about something this visible. */}
        <View>
          <Txt variant="small" muted style={{ marginBottom: space.sm, marginLeft: space.xs }}>
            Appearance
          </Txt>
          <Card padded={false}>
            <View style={{ flexDirection: 'row', padding: space.sm, gap: space.xs }}>
              {([
                { id: 'light',  label: 'Light'  },
                { id: 'dark',   label: 'Dark'   },
                { id: 'system', label: 'System' },
              ] as const).map((o) => (
                <Pressable
                  key={o.id}
                  onPress={() => setPref(o.id)}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 10,
                    alignItems: 'center',
                    backgroundColor: pref === o.id ? t.primarySoft : 'transparent',
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: pref === o.id }}
                >
                  <Txt variant="small" color={pref === o.id ? t.primary : t.textMuted}>
                    {o.label}
                  </Txt>
                </Pressable>
              ))}
            </View>
          </Card>
        </View>

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
      <UpgradeSheet visible={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarBadge: {
    position: 'absolute', right: -2, bottom: -2,
    width: 22, height: 22, borderRadius: 11, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
});
