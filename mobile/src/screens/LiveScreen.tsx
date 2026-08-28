import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, StyleSheet, Pressable, Alert, ScrollView, ActivityIndicator, BackHandler, AppState,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { BlurView } from 'expo-blur';

import { api, unwrap, getApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme, isIOS } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { entitlements, PLATFORM_META, UPGRADE_COPY } from '@/constants/entitlements';
import { Txt, Badge, Button } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { FeedbackSheet } from '@/components/FeedbackSheet';
import { startPublishing, isPublishingAvailable, PUBLISHING_UNAVAILABLE_MESSAGE, type PublishHandle } from '@/lib/publisher';
import type { RootStackParams } from '@/navigation';

interface Metric { platform: string; viewers?: number; comments?: number }
interface Comment { id: string; platform: string; author: string; text: string; created_at: string }

const POLL_MS = 5_000;

/**
 * The live screen.
 *
 * Everything here is subordinate to one fact: the creator is on air. That
 * shapes several decisions that would be wrong on any other screen —
 *
 *  • The screen never sleeps. A phone dimming and locking mid-broadcast is a
 *    dropped stream, so keep-awake is held for exactly as long as this screen
 *    is mounted and released the moment it is not.
 *
 *  • Leaving is guarded. Android's back gesture and the header's close button
 *    both ask first, because the distance between "go back" and "end my
 *    broadcast" should never be one accidental swipe.
 *
 *  • Controls sit over the preview on a blur, not in a panel below it. On a
 *    phone held at arm's length the preview is the interface; a creator
 *    checking their framing should not have to look somewhere else to mute.
 */
export default function LiveScreen() {
  const { t } = useTheme();
  const nav = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParams, 'Live'>>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const ent = entitlements(user?.plan);
  const { streamId } = route.params;

  const [camPerm] = useCameraPermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [micOn, setMicOn] = useState(true);
  const [status, setStatus] = useState<'starting' | 'live' | 'ending'>('starting');
  const [elapsed, setElapsed] = useState(0);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [showFeedback, setShowFeedback] = useState<null | 'ended' | 'cancelled'>(null);
  const [panel, setPanel] = useState<'stats' | 'comments'>('stats');

  const startedAt = useRef<number>(Date.now());
  /** The live publishing session. Null until the pipeline is up. */
  const publisher = useRef<PublishHandle | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Keep the screen awake for the duration ────────────────────────
  useEffect(() => {
    void activateKeepAwakeAsync('live-broadcast');
    return () => {
      void deactivateKeepAwake('live-broadcast');
      // Belt and braces: if this screen goes away by any route that did not
      // run endStream, the camera and producers still stop.
      void publisher.current?.stop().catch(() => {});
      publisher.current = null;
    };
  }, []);

  // ── Start the broadcast ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The server prepares the router and the RTMP fan-out first; there is
        // nothing to publish into until this returns.
        await api.post(`/streams/${streamId}/start`);
        if (cancelled) return;

        if (isPublishingAvailable()) {
          publisher.current = await startPublishing({
            streamId,
            facing: facing === 'front' ? 'front' : 'environment',
            audio: true,
            onFailed: (reason) => setPublishError(reason),
          });
        } else {
          // Expo Go. The broadcast exists server-side and the UI is honest
          // about why no video is leaving the device, rather than showing a
          // live badge over nothing.
          setPublishError(PUBLISHING_UNAVAILABLE_MESSAGE);
        }

        if (!cancelled) {
          setStatus('live');
          startedAt.current = Date.now();
          if (isIOS) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (err) {
        if (cancelled) return;
        Alert.alert('Could not go live', getApiError(err), [
          { text: 'Back', onPress: () => nav.goBack() },
        ]);
      }
    })();
    return () => { cancelled = true; };
  }, [streamId, nav]);

  // ── Duration ──────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'live') return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [status]);

  // ── Poll metrics and comments ─────────────────────────────────────
  const poll = useCallback(async () => {
    const [m, c] = await Promise.allSettled([
      api.get(`/streams/${streamId}/broadcast`).then(unwrap<{ metrics?: Metric[] }>),
      api.get(`/streams/${streamId}/comments`, { params: { limit: 40 } }).then(unwrap<Comment[]>),
    ]);
    if (m.status === 'fulfilled' && m.value?.metrics) setMetrics(m.value.metrics);
    if (c.status === 'fulfilled' && Array.isArray(c.value)) setComments(c.value);
  }, [streamId]);

  useEffect(() => {
    if (status !== 'live') return;
    void poll();
    pollRef.current = setInterval(() => void poll(), POLL_MS);

    // Polling while backgrounded burns battery and cellular data for updates
    // nobody can see. Suspend it, and refresh immediately on return so the
    // numbers are current rather than however stale they were.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void poll();
        pollRef.current ??= setInterval(() => void poll(), POLL_MS);
      } else if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    });

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      sub.remove();
    };
  }, [status, poll]);

  // ── Guard the back gesture ────────────────────────────────────────
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      confirmEnd();
      return true; // consumed — never leave silently while live
    });
    return () => sub.remove();
  });

  const endStream = async (reason: 'ended' | 'cancelled') => {
    setStatus('ending');
    // Stop sending before telling the server to end, so the last frames are
    // flushed rather than cut mid-packet.
    try { await publisher.current?.stop(); } catch { /* already gone */ }
    publisher.current = null;
    try {
      await api.post(`/streams/${streamId}/end`);
    } catch (err) {
      Alert.alert('Problem ending stream', getApiError(err));
    }
    // Asked while it is still fresh — someone whose stream dropped frames will
    // say so now and never again.
    setShowFeedback(reason);
  };

  const confirmEnd = () => {
    if (status !== 'live') { nav.goBack(); return; }
    Alert.alert(
      'End this broadcast?',
      'Your stream will stop on every platform. This cannot be undone.',
      [
        { text: 'Keep streaming', style: 'cancel' },
        { text: 'End stream', style: 'destructive', onPress: () => void endStream('ended') },
      ],
    );
  };

  const flip = () => {
    if (!ent.cameraSwitching) { Alert.alert('Premium feature', UPGRADE_COPY.cameraSwitching); return; }
    setFacing((f) => (f === 'front' ? 'back' : 'front'));
    // Swaps the capture device behind the same track, so the broadcast does
    // not freeze while a new producer is negotiated.
    void publisher.current?.flipCamera();
  };

  const mmss = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  };

  const totalViewers = metrics.reduce((sum, m) => sum + (m.viewers ?? 0), 0);

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      {/* Preview fills the screen; everything else floats over it. */}
      {camPerm?.granted && (
        <CameraView style={StyleSheet.absoluteFill} facing={facing} mode="video" />
      )}

      {/* ── Top bar ───────────────────────────────────────────────── */}
      <View style={[styles.topBar, { paddingTop: insets.top + space.sm }]}>
        <View style={styles.pill}>
          {isIOS && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          {status === 'starting'
            ? <ActivityIndicator size="small" color="#FFF" />
            : <View style={[styles.liveDot, { backgroundColor: t.live }]} />}
          <Txt variant="caption" color="#FFFFFF">
            {status === 'starting' ? 'STARTING'
              : status === 'ending' ? 'ENDING'
              : publishError ? 'NO SIGNAL'
              : 'LIVE'}
          </Txt>
          {status === 'live' && (
            <Txt variant="caption" color="rgba(255,255,255,0.75)">{mmss(elapsed)}</Txt>
          )}
        </View>

        <View style={{ flex: 1 }} />

        <View style={styles.pill}>
          {isIOS && <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />}
          <Icon name="eye" size={13} color="#FFFFFF" />
          <Txt variant="caption" color="#FFFFFF">{totalViewers}</Txt>
        </View>

        <Pressable onPress={confirmEnd} style={styles.closeBtn} hitSlop={10}>
          {isIOS && <BlurView intensity={40} tint="dark" style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />}
          <Icon name="close" size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Honest state.
      
          A "LIVE" badge over a broadcast that is sending nothing is the worst
          thing this screen could do — a creator would talk to an empty room
          and only find out afterwards. When the pipeline is not up, it says
          so, plainly, over the preview. */}
      {publishError && (
        <View style={[styles.warnBanner, { backgroundColor: 'rgba(229,72,77,0.94)' }]}>
          <Icon name="alert" size={15} color="#FFFFFF" />
          <Txt variant="small" color="#FFFFFF" style={{ flex: 1, lineHeight: 18 }}>
            {publishError}
          </Txt>
        </View>
      )}

      {/* ── Bottom sheet: stats / comments ────────────────────────── */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.md }]}>
        {isIOS
          ? <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
          : <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,8,24,0.92)' }]} />}

        <View style={styles.tabs}>
          {(['stats', 'comments'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setPanel(k)}
              style={[styles.tab, panel === k && { backgroundColor: 'rgba(255,255,255,0.14)' }]}
            >
              <Txt variant="small" color={panel === k ? '#FFFFFF' : 'rgba(255,255,255,0.6)'}>
                {k === 'stats' ? 'Platforms' : `Comments${comments.length ? ` (${comments.length})` : ''}`}
              </Txt>
            </Pressable>
          ))}
        </View>

        <ScrollView style={{ maxHeight: 190 }} showsVerticalScrollIndicator={false}>
          {panel === 'stats' ? (
            <View style={{ gap: space.sm, paddingBottom: space.md }}>
              {metrics.length === 0 ? (
                <Txt variant="small" color="rgba(255,255,255,0.55)" style={{ padding: space.md }}>
                  Waiting for platform data…
                </Txt>
              ) : metrics.map((m) => (
                <View key={m.platform} style={styles.metricRow}>
                  <View style={[styles.platDot, { backgroundColor: PLATFORM_META[m.platform]?.color ?? '#888' }]} />
                  <Txt variant="small" color="#FFFFFF" style={{ flex: 1 }}>
                    {PLATFORM_META[m.platform]?.label ?? m.platform}
                  </Txt>
                  <Txt variant="small" color="rgba(255,255,255,0.75)">{m.viewers ?? 0} watching</Txt>
                </View>
              ))}
            </View>
          ) : (
            <View style={{ gap: space.md, paddingBottom: space.md }}>
              {comments.length === 0 ? (
                <Txt variant="small" color="rgba(255,255,255,0.55)" style={{ padding: space.md }}>
                  {/* Honest about a real platform limitation rather than
                      leaving an empty box people assume is broken. */}
                  No comments yet. Only YouTube and Facebook report comments back.
                </Txt>
              ) : comments.map((c) => (
                <View key={c.id} style={{ gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <View style={[styles.platDot, { backgroundColor: PLATFORM_META[c.platform]?.color ?? '#888' }]} />
                    <Txt variant="caption" color="rgba(255,255,255,0.7)">{c.author}</Txt>
                  </View>
                  <Txt variant="small" color="#FFFFFF">{c.text}</Txt>
                </View>
              ))}
            </View>
          )}
        </ScrollView>

        {/* Controls */}
        <View style={styles.controls}>
          <Pressable
            onPress={() => {
              const next = !micOn;
              setMicOn(next);
              // Toggling the track keeps the producer alive — muting by
              // closing it would drop audio from every platform and need a
              // renegotiation to restore.
              publisher.current?.setMicEnabled(next);
            }}
            style={[styles.ctrlBtn, !micOn && { backgroundColor: t.live }]}
          >
            <Icon name={micOn ? 'mic' : 'micOff'} size={20} color="#FFFFFF" />
          </Pressable>

          {ent.cameraSwitching && (
            <Pressable onPress={flip} style={styles.ctrlBtn}>
              <Icon name="switchCamera" size={20} color="#FFFFFF" />
            </Pressable>
          )}

          <Button
            title={status === 'ending' ? 'Ending…' : 'End stream'}
            variant="danger"
            onPress={confirmEnd}
            loading={status === 'ending'}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      <FeedbackSheet
        streamId={streamId}
        reason={showFeedback ?? 'ended'}
        visible={showFeedback !== null}
        onClose={() => { setShowFeedback(null); nav.goBack(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5,
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingBottom: space.sm,
  },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.md, paddingVertical: 7,
    borderRadius: radius.full, overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  warnBanner: {
    position: 'absolute', left: space.lg, right: space.lg, top: '38%',
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.md,
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    paddingHorizontal: space.lg, paddingTop: space.md,
    gap: space.md,
  },
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: { paddingHorizontal: space.lg, paddingVertical: 7, borderRadius: radius.full },
  metricRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 5 },
  platDot: { width: 8, height: 8, borderRadius: 4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  ctrlBtn: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
});
