import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, Alert, Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, unwrap, getApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { entitlements, PLATFORM_META, UPGRADE_COPY } from '@/constants/entitlements';
import { Screen } from '@/components/Screen';
import { Card, Txt, Badge, Button, Field } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PlatformIcon, type PlatformId } from '@/components/PlatformIcon';

interface Connection {
  platform: string;
  ready?: boolean;
  status?: string;
  platform_username?: string | null;
}

/**
 * Platform connections.
 *
 * Two ways in, and the distinction is real rather than cosmetic:
 *
 *  • OAuth, where the platform hands us a stream key automatically.
 *  • A stream key typed in by hand, for platforms with no usable live API.
 *    Kick has none at all, and TikTok's support confirmed in writing there is
 *    no public LIVE API — so for those the key is the actual path, not a
 *    fallback. Saying so on the card saves people hunting for a Connect button
 *    that was never going to exist.
 */
export default function PlatformsScreen() {
  const { t, gutter } = useTheme();
  const { user } = useAuth();
  const ent = entitlements(user?.plan);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [rtmpUrl, setRtmpUrl] = useState('');
  const [streamKey, setStreamKey] = useState('');
  const [saving, setSaving] = useState(false);

  // Platforms whose live API cannot give us a key programmatically.
  const KEY_ONLY = new Set(['kick', 'tiktok', 'instagram', 'twitter', 'linkedin']);

  const load = useCallback(async () => {
    try {
      setConnections(await api.get('/platforms').then(unwrap<Connection[]>) ?? []);
    } catch { /* leave the list as-is */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const conn = (id: string) => connections.find((c) => c.platform === id);
  const isReady = (id: string) => { const c = conn(id); return !!(c?.ready ?? c?.status === 'connected'); };

  const connectOAuth = async (id: string) => {
    if (!ent.platforms.includes(id)) { Alert.alert('Not on your plan', UPGRADE_COPY.platforms); return; }
    try {
      // POST /platforms/connect/oauth — the same route the web dashboard uses.
      // Verified against the backend rather than assumed: an invented path
      // fails at the worst moment, when someone is trying to connect.
      const { authUrl } = await api
        .post('/platforms/connect/oauth', { platform: id })
        .then(unwrap<{ authUrl: string }>);
      // The system browser, not a WebView: providers block embedded WebViews,
      // and the shared session means an already-signed-in user taps once.
      await WebBrowser.openBrowserAsync(authUrl);
      // No callback to await here — the browser closes on the user's terms, so
      // refresh on return and let the list tell the truth.
      await load();
    } catch (err) {
      Alert.alert('Could not connect', getApiError(err));
    }
  };

  const saveKey = async () => {
    if (!keyFor || !streamKey.trim()) return;
    setSaving(true);
    try {
      await api.post('/platforms/connect/manual', {
        platform: keyFor,
        rtmpUrl: rtmpUrl.trim() || undefined,
        streamKey: streamKey.trim(),
      });
      setKeyFor(null); setRtmpUrl(''); setStreamKey('');
      await load();
    } catch (err) {
      Alert.alert('Could not save', getApiError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen title="Platforms" subtitle="Connect where you broadcast."
            refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ paddingHorizontal: gutter, gap: space.md }}>
        {Object.entries(PLATFORM_META).map(([id, meta]) => {
          const allowed = ent.platforms.includes(id);
          const ready = isReady(id);
          const keyOnly = KEY_ONLY.has(id);
          const editing = keyFor === id;

          return (
            <Card key={id} style={{ opacity: allowed ? 1 : 0.55, gap: space.md }}>
              <View style={styles.row}>
                <PlatformIcon platform={id as PlatformId} size={26} />
                <View style={{ flex: 1 }}>
                  <Txt variant="h3">{meta.label}</Txt>
                  <Txt variant="small" muted style={{ marginTop: 2 }}>
                    {ready
                      ? conn(id)?.platform_username
                        ? `Connected as ${conn(id)?.platform_username}`
                        : 'Connected'
                      : keyOnly ? 'Stream key required' : 'Not connected'}
                  </Txt>
                </View>
                {ready ? <Badge label="Ready" tone="success" />
                       : !allowed ? <Icon name="lock" size={16} /> : null}
              </View>

              {meta.comments && (
                <Txt variant="small" muted>Reports viewers and comments back to you.</Txt>
              )}

              {editing ? (
                <View style={{ gap: space.md }}>
                  <Field
                    label="RTMP URL (optional)"
                    value={rtmpUrl}
                    onChangeText={setRtmpUrl}
                    placeholder="rtmp://…"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Field
                    label="Stream key"
                    value={streamKey}
                    onChangeText={setStreamKey}
                    placeholder="Paste your stream key"
                    autoCapitalize="none"
                    autoCorrect={false}
                    secureTextEntry
                  />
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Button title="Cancel" variant="ghost" style={{ flex: 1 }}
                            onPress={() => { setKeyFor(null); setStreamKey(''); setRtmpUrl(''); }} />
                    <Button title="Save" style={{ flex: 1 }} loading={saving}
                            disabled={!streamKey.trim()} onPress={saveKey} />
                  </View>
                </View>
              ) : allowed && (
                <View style={{ flexDirection: 'row', gap: space.sm }}>
                  {!keyOnly && (
                    <Button
                      title={ready ? 'Reconnect' : 'Connect'}
                      variant={ready ? 'secondary' : 'primary'}
                      size="sm"
                      onPress={() => connectOAuth(id)}
                    />
                  )}
                  <Button
                    title={ready ? 'Replace key' : 'Enter stream key'}
                    variant={keyOnly && !ready ? 'primary' : 'secondary'}
                    size="sm"
                    onPress={() => setKeyFor(id)}
                  />
                </View>
              )}
            </Card>
          );
        })}

        {ent.maxPlatforms < 8 && (
          <Card>
            <Txt variant="h3">More destinations</Txt>
            <Txt variant="small" muted style={{ marginTop: 6, lineHeight: 20 }}>
              {UPGRADE_COPY.platforms}
            </Txt>
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
