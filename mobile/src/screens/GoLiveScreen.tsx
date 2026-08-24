import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { api, unwrap, getApiError } from '@/api/client';
import { useAuth } from '@/store/auth';
import { useTheme, isIOS } from '@/hooks/useTheme';
import { space, radius } from '@/constants/theme';
import { entitlements, PLATFORM_META, UPGRADE_COPY } from '@/constants/entitlements';
import { Screen } from '@/components/Screen';
import { Card, Txt, Button, Field, Badge } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface Connection { platform: string; ready?: boolean; status?: string }

/**
 * Go Live — set up and start a broadcast.
 *
 * Order matters here and is deliberate: preview first, then title, then
 * destinations, then the button. A creator wants to see themselves before
 * anything else — checking framing and lighting is the first thing anyone does
 * — and a form that opens with a text field makes them scroll past it.
 *
 * The camera runs only while this screen has focus. Holding it open in the
 * background keeps the capture light on, which people notice and rightly
 * dislike.
 */
export default function GoLiveScreen() {
  const { t, gutter } = useTheme();
  const nav = useNavigation<any>();
  const { user } = useAuth();
  const ent = entitlements(user?.plan);

  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();

  const [facing, setFacing] = useState<'front' | 'back'>('front');
  const [previewOn, setPreviewOn] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [starting, setStarting] = useState(false);
  const [loadingConn, setLoadingConn] = useState(true);

  useEffect(() => {
    api.get('/platforms')
      .then((r) => setConnections(unwrap<Connection[]>(r) ?? []))
      .catch(() => setConnections([]))
      .finally(() => setLoadingConn(false));
  }, []);

  const connected = useCallback(
    (id: string) => connections.some((c) => c.platform === id && (c.ready ?? c.status === 'connected')),
    [connections],
  );

  const togglePlatform = (id: string) => {
    if (!ent.platforms.includes(id)) {
      Alert.alert('Not on your plan', UPGRADE_COPY.platforms);
      return;
    }
    if (!connected(id)) {
      Alert.alert(
        `${PLATFORM_META[id]?.label ?? id} isn't connected`,
        'Connect it under Platforms before you can stream there.',
        [{ text: 'Not now', style: 'cancel' },
         { text: 'Open Platforms', onPress: () => nav.navigate('Platforms') }],
      );
      return;
    }
    if (isIOS) void Haptics.selectionAsync();
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= ent.maxPlatforms) {
        Alert.alert(
          'Platform limit reached',
          `Your plan allows ${ent.maxPlatforms} at a time. Deselect one, or upgrade for all 8.`,
        );
        return prev;
      }
      return [...prev, id];
    });
  };

  const enablePreview = async () => {
    // Camera and mic asked for together: a broadcast needs both, and two
    // prompts separated by a screen of work feels like nagging.
    const cam = camPerm?.granted ? camPerm : await requestCam();
    if (!cam?.granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to preview and go live.');
      return;
    }
    if (!micPerm?.granted) await requestMic();
    setPreviewOn(true);
  };

  const flipCamera = () => {
    if (!ent.cameraSwitching) {
      Alert.alert('Premium feature', UPGRADE_COPY.cameraSwitching);
      return;
    }
    if (isIOS) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFacing((f) => (f === 'front' ? 'back' : 'front'));
  };

  const canStart = title.trim().length > 0 && selected.length > 0 && !starting;

  const handleGoLive = async () => {
    if (!canStart) return;
    setStarting(true);
    try {
      const stream = await api.post('/streams', {
        title: title.trim(),
        description: description.trim() || undefined,
        platforms: selected,
      }).then(unwrap<{ id: string }>);

      nav.navigate('Live', { streamId: stream.id });
      // Cleared so returning to this tab starts fresh rather than showing a
      // stale form for a broadcast already running.
      setTitle(''); setDescription(''); setSelected([]);
    } catch (err) {
      Alert.alert('Could not start', getApiError(err));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Screen title="Go Live" subtitle="One broadcast, every platform.">
      <View style={{ paddingHorizontal: gutter, gap: space.lg }}>

        {/* Preview */}
        <View style={[styles.preview, { backgroundColor: '#000', borderColor: t.border }]}>
          {previewOn && camPerm?.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing={facing} mode="video" />
          ) : (
            <View style={styles.previewEmpty}>
              <Icon name="camera" size={30} color="rgba(255,255,255,0.4)" />
              <Txt variant="small" color="rgba(255,255,255,0.55)">Camera is off</Txt>
            </View>
          )}

          <View style={styles.previewControls}>
            <Pressable
              onPress={previewOn ? () => setPreviewOn(false) : enablePreview}
              style={[styles.circleBtn, { backgroundColor: previewOn ? 'rgba(255,255,255,0.16)' : t.primary }]}
            >
              <Icon name={previewOn ? 'cameraOff' : 'camera'} size={20} color="#FFFFFF" />
            </Pressable>

            {previewOn && ent.cameraSwitching && (
              <Pressable onPress={flipCamera} style={[styles.circleBtn, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
                <Icon name="switchCamera" size={20} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Details */}
        <Card style={{ gap: space.lg }}>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Friday night Q&A"
            maxLength={120}
            returnKeyType="next"
          />
          <Field
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="Tell viewers what to expect…"
            multiline
            numberOfLines={3}
            maxLength={500}
            style={{ minHeight: 84, textAlignVertical: 'top' }}
          />
        </Card>

        {/* Destinations */}
        <Card style={{ gap: space.md }}>
          <View style={styles.rowBetween}>
            <Txt variant="h3">Broadcast to</Txt>
            <Txt variant="small" muted>{selected.length}/{ent.maxPlatforms}</Txt>
          </View>

          {loadingConn ? (
            <ActivityIndicator color={t.textMuted} style={{ paddingVertical: space.xl }} />
          ) : (
            <View style={styles.platGrid}>
              {Object.keys(PLATFORM_META).map((id) => {
                const meta = PLATFORM_META[id]!;
                const allowed = ent.platforms.includes(id);
                const isOn = selected.includes(id);
                const isReady = connected(id);

                return (
                  <Pressable
                    key={id}
                    onPress={() => togglePlatform(id)}
                    style={({ pressed }) => [
                      styles.platItem,
                      {
                        borderColor: isOn ? t.primary : t.border,
                        backgroundColor: isOn ? t.primarySoft : t.surfaceAlt,
                        opacity: !allowed ? 0.45 : pressed ? 0.7 : 1,
                      },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isOn, disabled: !allowed }}
                    accessibilityLabel={meta.label}
                  >
                    <View style={[styles.platDot, { backgroundColor: meta.color }]} />
                    <Txt variant="small" numberOfLines={1} style={{ flex: 1 }}>{meta.label}</Txt>
                    {!allowed
                      ? <Icon name="lock" size={13} />
                      : isOn
                        ? <Icon name="check" size={14} color={t.primary} />
                        : !isReady
                          ? <Txt variant="caption" muted>Connect</Txt>
                          : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {ent.maxPlatforms < 8 && (
            <Txt variant="small" muted style={{ lineHeight: 19 }}>
              {UPGRADE_COPY.platforms}
            </Txt>
          )}
        </Card>

        <Button
          title="Create and go live"
          size="lg"
          fullWidth
          loading={starting}
          disabled={!canStart}
          icon={<Icon name="broadcast" size={18} color="#FFFFFF" />}
          onPress={handleGoLive}
        />
        {!canStart && !starting && (
          <Txt variant="small" muted style={{ textAlign: 'center' }}>
            {title.trim() ? 'Pick at least one platform.' : 'Add a title to continue.'}
          </Txt>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    aspectRatio: 16 / 10,
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'flex-end',
  },
  previewEmpty: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  previewControls: {
    flexDirection: 'row', gap: space.md,
    alignSelf: 'center', marginBottom: space.lg,
  },
  circleBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  platGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  platItem: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    flexBasis: '47.5%', flexGrow: 1,
    paddingHorizontal: space.md, paddingVertical: space.md,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth,
  },
  platDot: { width: 9, height: 9, borderRadius: 5 },
});
