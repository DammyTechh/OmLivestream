import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { api, unwrap } from '@/api/client';
import { useTheme } from '@/hooks/useTheme';
import { space } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { Card, Txt, EmptyState, Badge } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface Recording {
  id: string; title?: string; stream_title?: string;
  duration_seconds?: number; size_bytes?: number;
  status?: string; url?: string; created_at: string;
}

const dur = (s?: number) => {
  if (!s) return '—';
  const m = Math.floor(s / 60), sec = s % 60;
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(sec).padStart(2, '0')}s`;
};
const size = (b?: number) => (b ? `${(b / 1_048_576).toFixed(0)} MB` : '');

/**
 * Recordings.
 *
 * Available on every plan on purpose — a trial that leaves nothing behind
 * produces nothing to show for it. Playback opens in the system player rather
 * than an embedded one: these are long files, and the OS player already has
 * scrubbing, AirPlay and background audio that would take weeks to match.
 */
export default function RecordingsScreen() {
  const { t, gutter } = useTheme();
  const [items, setItems] = useState<Recording[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.get('/recordings').then(unwrap<Recording[]>) ?? []);
    } catch { /* keep current list */ }
    setLoaded(true);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true); await load(); setRefreshing(false);
  }, [load]);

  return (
    <Screen title="Recordings" subtitle="Every broadcast, saved."
            refreshing={refreshing} onRefresh={onRefresh}>
      <View style={{ paddingHorizontal: gutter }}>
        {!loaded ? null : items.length === 0 ? (
          <Card>
            <EmptyState
              title="No recordings yet"
              message="Your broadcasts are saved here automatically once they end."
            />
          </Card>
        ) : (
          <Card padded={false}>
            {items.map((r, i) => {
              const ready = r.status === 'ready' || !!r.url;
              return (
                <Pressable
                  key={r.id}
                  disabled={!ready || !r.url}
                  onPress={() => r.url && void Linking.openURL(r.url)}
                  style={({ pressed }) => [
                    styles.row,
                    { borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                      borderTopColor: t.border, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Icon name="video" size={20} />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Txt variant="bodyMed" numberOfLines={1}>
                      {r.title ?? r.stream_title ?? 'Untitled broadcast'}
                    </Txt>
                    <Txt variant="small" muted>
                      {dur(r.duration_seconds)}{size(r.size_bytes) ? ` · ${size(r.size_bytes)}` : ''}
                    </Txt>
                  </View>
                  {ready ? <Icon name="chevronRight" size={18} />
                         : <Badge label="Processing" tone="neutral" />}
                </Pressable>
              );
            })}
          </Card>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg },
});
