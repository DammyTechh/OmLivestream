import React, { useCallback, useEffect, useState } from 'react';
import { View, Pressable, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
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
import { PlatformIcon, type PlatformId } from '@/components/PlatformIcon';

interface Connection { platform: string; ready?: boolean; status?: string }

type SourceMode = 'camera' | 'avatar' | 'image';

/**
 * Look filters, matching the website's set exactly.
 *
 * Applied as an overlay tint rather than a real shader: expo-camera has no
 * filter API, and pulling a GPU pipeline in to colour-grade a *preview* would
 * cost startup time and battery for something the broadcast does not yet
 * carry. The chosen filter is sent with the stream so the server pipeline can
 * apply it for real — the preview's job is to show the creator what they
 * picked, not to be the encoder.
 */
const FILTERS: { id: string; label: string; tint: string; opacity: number }[] = [
  { id: 'none',      label: 'Normal', tint: 'transparent', opacity: 0    },
  { id: 'grayscale', label: 'B&W',    tint: '#808080',     opacity: 0.55 },
  { id: 'sepia',     label: 'Sepia',  tint: '#8B6B3D',     opacity: 0.35 },
  { id: 'cool',      label: 'Cool',   tint: '#2E5BFF',     opacity: 0.22 },
  { id: 'warm',      label: 'Warm',   tint: '#FF8A3D',     opacity: 0.20 },
  { id: 'vivid',     label: 'Vivid',  tint: '#FF2D9B',     opacity: 0.14 },
];

/** Stand-ins for creators who broadcast without showing their face. */
const AVATARS = ['🎙️', '🎧', '🎮', '📻', '🎬', '🎤', '🌟', '🔥'];

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
  const [sourceMode, setSourceMode] = useState<SourceMode>('camera');
  const [filter, setFilter] = useState('none');
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
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

  const activeFilter = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];

  /** Pick a still to broadcast over — slides, a poster, a holding card. */
  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos access needed', 'Allow photo access to choose an image.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [16, 9],
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]) setBgImage(res.assets[0].uri);
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
        // Carried through so the server pipeline can reproduce what the
        // creator set up here rather than guessing.
        source_mode: sourceMode,
        filter: filter !== 'none' ? filter : undefined,
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
        <View
          style={[
            styles.preview,
            {
              backgroundColor: '#000',
              borderColor: t.border,
              // Expanded drops the 16:10 crop for a tall portrait frame — the
              // shape a phone actually broadcasts in, so the creator can check
              // their real framing rather than a letterboxed approximation.
              aspectRatio: expanded ? 9 / 16 : 16 / 10,
            },
          ]}
        >
          {sourceMode === 'camera' && previewOn && camPerm?.granted ? (
            <>
              <CameraView style={StyleSheet.absoluteFill} facing={facing} mode="video" />
              {/* The look, as a tint. See the note on FILTERS. */}
              {activeFilter.opacity > 0 && (
                <View
                  pointerEvents="none"
                  style={[
                    StyleSheet.absoluteFill,
                    { backgroundColor: activeFilter.tint, opacity: activeFilter.opacity },
                  ]}
                />
              )}
            </>
          ) : sourceMode === 'avatar' ? (
            <View style={styles.previewEmpty}>
              <Txt variant="display" style={{ fontSize: expanded ? 96 : 64 }}>{avatar}</Txt>
              <Txt variant="small" color="rgba(255,255,255,0.55)">Streaming without camera</Txt>
            </View>
          ) : sourceMode === 'image' && bgImage ? (
            <Image source={{ uri: bgImage }} style={StyleSheet.absoluteFill} contentFit="cover" />
          ) : (
            <View style={styles.previewEmpty}>
              <Icon name={sourceMode === 'image' ? 'video' : 'camera'} size={30} color="rgba(255,255,255,0.4)" />
              <Txt variant="small" color="rgba(255,255,255,0.55)">
                {sourceMode === 'image' ? 'No image chosen' : 'Camera is off'}
              </Txt>
            </View>
          )}

          {/* Expand — top-right, out of the way of the shot. */}
          <Pressable
            onPress={() => setExpanded((v) => !v)}
            style={[styles.cornerBtn, { top: space.md, right: space.md }]}
            hitSlop={8}
            accessibilityLabel={expanded ? 'Shrink preview' : 'Expand preview'}
          >
            <Icon name={expanded ? 'close' : 'screenShare'} size={16} color="#FFFFFF" />
          </Pressable>

          <View style={styles.previewControls}>
            {sourceMode === 'camera' && (
              <Pressable
                onPress={previewOn ? () => setPreviewOn(false) : enablePreview}
                style={[styles.circleBtn, { backgroundColor: previewOn ? 'rgba(255,255,255,0.16)' : t.primary }]}
              >
                <Icon name={previewOn ? 'cameraOff' : 'camera'} size={20} color="#FFFFFF" />
              </Pressable>
            )}

            {sourceMode === 'camera' && previewOn && ent.cameraSwitching && (
              <Pressable onPress={flipCamera} style={[styles.circleBtn, { backgroundColor: 'rgba(255,255,255,0.16)' }]}>
                <Icon name="switchCamera" size={20} color="#FFFFFF" />
              </Pressable>
            )}

            {sourceMode === 'image' && (
              <Pressable onPress={pickImage} style={[styles.circleBtn, { backgroundColor: t.primary }]}>
                <Icon name="plus" size={20} color="#FFFFFF" />
              </Pressable>
            )}
          </View>
        </View>

        {/* Source: camera, avatar, or a still. Matches the website's three
            options — a creator who streams audio-only or over slides should
            not have to point a camera at a wall. */}
        <View style={styles.sourceTabs}>
          {([
            { id: 'camera', label: 'Camera', icon: 'camera'  },
            { id: 'avatar', label: 'Avatar', icon: 'user'    },
            { id: 'image',  label: 'Image',  icon: 'video'   },
          ] as const).map((m) => (
            <Pressable
              key={m.id}
              onPress={() => {
                if (isIOS) void Haptics.selectionAsync();
                setSourceMode(m.id);
                // Release the camera when it is not the source — otherwise the
                // capture light stays on behind an avatar.
                if (m.id !== 'camera') setPreviewOn(false);
              }}
              style={[
                styles.sourceTab,
                {
                  backgroundColor: sourceMode === m.id ? t.primary : t.surfaceAlt,
                  borderColor: sourceMode === m.id ? t.primary : t.border,
                },
              ]}
            >
              <Icon name={m.icon} size={16} color={sourceMode === m.id ? '#FFFFFF' : t.textMuted} />
              <Txt variant="small" color={sourceMode === m.id ? '#FFFFFF' : t.textMuted}>{m.label}</Txt>
            </Pressable>
          ))}
        </View>

        {/* Avatar picker */}
        {sourceMode === 'avatar' && (
          <Card style={{ gap: space.md }}>
            <Txt variant="small" muted>Choose an avatar</Txt>
            <View style={styles.avatarRow}>
              {AVATARS.map((a) => (
                <Pressable
                  key={a}
                  onPress={() => setAvatar(a)}
                  style={[
                    styles.avatarChip,
                    {
                      backgroundColor: avatar === a ? t.primarySoft : t.surfaceAlt,
                      borderColor: avatar === a ? t.primary : t.border,
                    },
                  ]}
                >
                  <Txt variant="h2">{a}</Txt>
                </Pressable>
              ))}
            </View>
          </Card>
        )}

        {/* Filters — camera only; tinting a still or an emoji is meaningless. */}
        {sourceMode === 'camera' && previewOn && (
          <Card style={{ gap: space.md }}>
            <Txt variant="small" muted>Look</Txt>
            <View style={styles.filterRow}>
              {FILTERS.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: filter === f.id ? t.primarySoft : t.surfaceAlt,
                      borderColor: filter === f.id ? t.primary : t.border,
                    },
                  ]}
                >
                  <Txt variant="small" color={filter === f.id ? t.primary : t.textMuted}>{f.label}</Txt>
                </Pressable>
              ))}
            </View>
          </Card>
        )}

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
                    <PlatformIcon platform={id as PlatformId} size={20} />
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
  cornerBtn: {
    position: 'absolute', width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sourceTabs: { flexDirection: 'row', gap: space.sm },
  sourceTab: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 11, borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  avatarChip: {
    width: 52, height: 52, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  filterChip: {
    paddingHorizontal: space.lg, paddingVertical: 9,
    borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth,
  },
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
