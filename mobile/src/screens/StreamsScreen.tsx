import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api, unwrap } from '@/api/client';
import { useTheme } from '@/hooks/useTheme';
import { space } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { Card, Txt, Badge, EmptyState, Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { PlatformIcon, type PlatformId } from '@/components/PlatformIcon';
import { PLATFORM_META } from '@/constants/entitlements';

interface Stream {
  id: string; title: string;
  status: 'scheduled' | 'live' | 'ended';
  created_at: string; platforms?: string[];
}

type Filter = 'all' | 'live' | 'scheduled' | 'ended';

/**
 * Every broadcast, past and scheduled.
 *
 * Filters are chips rather than a segmented control: there are four, and one
 * of them ("all") is the default — a segmented control implies equal weight
 * between options, which these do not have.
 */
export default function StreamsScreen() {
  const { t, gutter } = useTheme();
  const nav = useNavigation<any>();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/streams', { params: { limit: 50 } }).then(unwrap<Stream[]>);
      setStreams(Array.isArray(data) ? data : []);
    } catch { /* keep whatever is on screen rather than blanking it */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  const shown = filter === 'all' ? streams : streams.filter((s) => s.status === filter);

  return (
    <Screen title="Your streams" subtitle="All your broadcasts." refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ paddingHorizontal: gutter, gap: space.lg }}>
        <View style={styles.chips}>
          {(['all', 'live', 'scheduled', 'ended'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[
                styles.chip,
                { borderColor: filter === f ? t.primary : t.border,
                  backgroundColor: filter === f ? t.primarySoft : 'transparent' },
              ]}
            >
              <Txt variant="small" color={filter === f ? t.primary : t.textMuted}
                   style={{ textTransform: 'capitalize' }}>
                {f}
              </Txt>
            </Pressable>
          ))}
        </View>

        {!loaded ? null : shown.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing here"
              message={filter === 'all'
                ? 'Create your first stream to get started.'
                : `No ${filter} streams right now.`}
              action={filter === 'all'
                ? <Button title="Go live" onPress={() => nav.navigate('GoLive')} />
                : undefined}
            />
          </Card>
        ) : (
          <Card padded={false}>
            {shown.map((s, i) => (
              <Pressable
                key={s.id}
                onPress={() => s.status === 'live' && nav.navigate('Live', { streamId: s.id })}
                style={({ pressed }) => [
                  styles.row,
                  { borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: t.border, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={{ flex: 1, gap: 6 }}>
                  <Txt variant="bodyMed" numberOfLines={1}>{s.title}</Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Badge
                      label={s.status}
                      tone={s.status === 'live' ? 'live' : s.status === 'scheduled' ? 'brand' : 'neutral'}
                      dot={s.status === 'live'}
                    />
                    {/* Destination marks — a row of real logos reads faster than text. */}
                    <View style={{ flexDirection: 'row', gap: 4 }}>
                      {(s.platforms ?? []).slice(0, 5).map((p) => (
                        <PlatformIcon key={p} platform={p as PlatformId} size={14} />
                      ))}
                    </View>
                  </View>
                </View>
                {s.status === 'live' && <Icon name="chevronRight" size={18} />}
              </Pressable>
            ))}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.lg, paddingVertical: 8, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
