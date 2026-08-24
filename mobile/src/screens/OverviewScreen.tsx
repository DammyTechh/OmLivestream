import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, unwrap } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { entitlements } from '@/constants/entitlements';
import { Screen } from '@/components/Screen';
import { Card, Txt, Badge, Button, EmptyState } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';

interface Overview {
  totalViews?: number;
  peakViewers?: number;
  totalComments?: number;
}
interface Stream {
  id: string;
  title: string;
  status: 'scheduled' | 'live' | 'ended';
  created_at: string;
  platforms?: string[];
}

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000   ? `${(n / 1_000).toFixed(1)}K`
  : String(n);

/**
 * Home.
 *
 * Answers, in order: are you live right now, what did your streams do, and
 * what would you like to do next. A creator opening the app mid-broadcast
 * should see that fact first and be one tap from the live screen — anything
 * else is the app making them hunt while they are on air.
 */
export default function OverviewScreen() {
  const { t, gutter } = useTheme();
  const nav = useNavigation<any>();
  const { user, refreshProfile } = useAuth();
  const ent = entitlements(user?.plan);

  const [overview, setOverview] = useState<Overview>({});
  const [recent, setRecent] = useState<Stream[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    // Settled, not all: a failing analytics call must not blank the stream
    // list, and vice versa. Each panel degrades on its own.
    const [ov, st] = await Promise.allSettled([
      api.get('/analytics/overview').then(unwrap<Overview>),
      api.get('/streams', { params: { limit: 5 } }).then(unwrap<Stream[]>),
    ]);
    if (ov.status === 'fulfilled') setOverview(ov.value ?? {});
    if (st.status === 'fulfilled') setRecent(Array.isArray(st.value) ? st.value : []);
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([load(), refreshProfile()]);
    setRefreshing(false);
  }, [load, refreshProfile]);

  const liveNow = recent.find((s) => s.status === 'live');
  const firstName = user?.full_name?.split(' ')[0] ?? 'there';

  const stats: { label: string; value: number; icon: IconName }[] = [
    { label: 'Total views',   value: overview.totalViews ?? 0,    icon: 'eye'   },
    { label: 'Peak audience', value: overview.peakViewers ?? 0,   icon: 'chart' },
    { label: 'Comments',      value: overview.totalComments ?? 0, icon: 'heart' },
    { label: 'Streams',       value: recent.length,               icon: 'video' },
  ];

  return (
    <Screen
      title={`Hello, ${firstName}`}
      subtitle={user?.plan === 'premium' ? 'Premium' : 'Free plan'}
      refreshing={refreshing}
      onRefresh={onRefresh}
    >
      <View style={{ paddingHorizontal: gutter, gap: space.lg }}>

        {/* Live banner — the most urgent thing this screen can say. */}
        {liveNow && (
          <Pressable onPress={() => nav.navigate('Live', { streamId: liveNow.id })}>
            <Card style={{ borderColor: t.live, backgroundColor: 'rgba(229,72,77,0.06)' }}>
              <View style={styles.row}>
                <View style={{ flex: 1, gap: 6 }}>
                  <Badge label="Live now" tone="live" dot />
                  <Txt variant="h3" numberOfLines={1}>{liveNow.title}</Txt>
                </View>
                <Icon name="chevronRight" size={20} color={t.live} />
              </View>
            </Card>
          </Pressable>
        )}

        {/* Primary action. One obvious thing to do. */}
        <Button
          title="Go live"
          size="lg"
          fullWidth
          icon={<Icon name="broadcast" size={18} color="#FFFFFF" />}
          onPress={() => nav.navigate('GoLive')}
        />

        {/* Stats — quiet glyphs, no coloured tiles. */}
        <View style={styles.grid}>
          {stats.map((s) => (
            <Card key={s.label} style={styles.statCard}>
              <Icon name={s.icon} size={17} />
              <Txt variant="h1" style={{ marginTop: space.md }}>
                {loaded ? fmt(s.value) : '—'}
              </Txt>
              <Txt variant="small" muted numberOfLines={1}>{s.label}</Txt>
            </Card>
          ))}
        </View>

        {/* Recent streams */}
        <View style={{ gap: space.md }}>
          <View style={styles.row}>
            <Txt variant="h2" style={{ flex: 1 }}>Recent streams</Txt>
            <Pressable onPress={() => nav.navigate('Streams')} hitSlop={10}>
              <Txt variant="small" color={t.primary}>View all</Txt>
            </Pressable>
          </View>

          {recent.length === 0 ? (
            <Card>
              <EmptyState
                title="No streams yet"
                message="Your broadcasts will appear here once you go live."
              />
            </Card>
          ) : (
            <Card padded={false}>
              {recent.slice(0, 5).map((s, i) => (
                <Pressable
                  key={s.id}
                  onPress={() => nav.navigate(s.status === 'live' ? 'Live' : 'Streams', { streamId: s.id })}
                  style={({ pressed }) => [
                    styles.streamRow,
                    { borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth, borderTopColor: t.border,
                      opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <View style={{ flex: 1, gap: 5 }}>
                    <Txt variant="bodyMed" numberOfLines={1}>{s.title}</Txt>
                    <Badge
                      label={s.status}
                      tone={s.status === 'live' ? 'live' : s.status === 'scheduled' ? 'brand' : 'neutral'}
                      dot={s.status === 'live'}
                    />
                  </View>
                  <Icon name="chevronRight" size={18} />
                </Pressable>
              ))}
            </Card>
          )}
        </View>

        {/* Upgrade nudge — shown once, plainly, not as a recurring banner. */}
        {user?.plan !== 'premium' && (
          <Card>
            <Txt variant="h3">Upgrade to Premium</Txt>
            <Txt variant="small" muted style={{ marginTop: 6, marginBottom: space.lg, lineHeight: 20 }}>
              Stream to all 8 platforms at once, reply to comments across every
              platform, and use AI Studio. You&apos;re currently limited to{' '}
              {ent.maxPlatforms === 1 ? 'one platform' : 'two platforms'}.
            </Txt>
            <Button title="See Premium" variant="secondary" onPress={() => nav.navigate('Settings')} />
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row:  { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  statCard: {
    // Two per row at any width, accounting for the gap.
    flexBasis: '47.5%', flexGrow: 1, minWidth: 140,
  },
  streamRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    padding: space.lg,
  },
});
