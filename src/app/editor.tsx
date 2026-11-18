import { Image } from 'expo-image';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';

import { OverlayLayer, dashFor } from '@/components/overlay-layer';
import { LinkButton, ScreenHeader, goToCamera, textStyles } from '@/components/ui';
import {
  BLUE,
  DANGER,
  Fonts,
  HAIRLINE,
  INK,
  LINE_PALETTE,
  LINE_STYLES,
  LINE_WIDTHS,
  MUTED,
  WHITE,
} from '@/constants/style';
import { makeId } from '@/lib/geometry';
import { photoUri } from '@/lib/storage';
import { OVERLAY_WIDTH, type DrawnLine, type Overlay, type Perspective, type Point } from '@/lib/types';
import { useAppStore } from '@/store/app-store';

const MIN_LINE_LENGTH = 8; // overlay units

/** Vertical mode: parallel to the photo's vertical, or converging toward VP3 in 3-point perspective. */
function snapVertical(start: Point, end: Point, overlay: Overlay, perspective: Perspective): Point {
  const vp3 = overlay.stars.find((s) => s.label === 'VP3');
  let dx: number;
  let dy: number;
  if (perspective === 3 && vp3) {
    dx = vp3.x - start.x;
    dy = vp3.y - start.y;
  } else {
    // Perpendicular to the captured horizon (accounts for phone roll).
    dx = -(overlay.horizon.y2 - overlay.horizon.y1);
    dy = overlay.horizon.x2 - overlay.horizon.x1;
  }
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return end;
  dx /= len;
  dy /= len;
  const t = (end.x - start.x) * dx + (end.y - start.y) * dy;
  return { x: start.x + dx * t, y: start.y + dy * t };
}

export default function EditorScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; source?: string }>();
  const { photos, draft, settings, updateSettings, saveDraft, updatePhotoLines, setDraft } = useAppStore();

  const [photoId, setPhotoId] = useState<string | null>(typeof params.id === 'string' ? params.id : null);
  const photo = photoId ? photos.find((p) => p.id === photoId) : undefined;
  const editingDraft = !photoId && params.source === 'draft' ? draft : null;

  const base = photo
    ? { uri: photoUri(photo.fileName), overlay: photo.overlay, perspective: photo.perspective }
    : editingDraft
      ? { uri: editingDraft.uri, overlay: editingDraft.overlay, perspective: editingDraft.perspective }
      : null;

  const [lines, setLines] = useState<DrawnLine[]>(() => photo?.lines ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [vertical, setVertical] = useState(false);
  const [pending, setPending] = useState<DrawnLine | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drawStart = useRef<Point | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    []
  );

  if (!base) {
    return (
      <View style={styles.root}>
        <ScreenHeader title="EDITOR" />
        <View style={styles.missing}>
          <Text style={textStyles.body}>This photo is no longer available.</Text>
          <LinkButton label="Back to camera" onPress={goToCamera} style={{ marginTop: 12 }} />
        </View>
      </View>
    );
  }

  const { overlay, perspective } = base;
  const aspect = OVERLAY_WIDTH / overlay.height;
  const dispW = area.w > 0 ? Math.min(area.w, area.h * aspect) : 0;
  const dispH = dispW / aspect;
  const unitsPerPx = dispW > 0 ? OVERLAY_WIDTH / dispW : 1;

  function flash(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  function toUnits(e: GestureResponderEvent): Point {
    return { x: e.nativeEvent.locationX * unitsPerPx, y: e.nativeEvent.locationY * unitsPerPx };
  }

  function lineFrom(start: Point, rawEnd: Point): DrawnLine {
    const end = vertical ? snapVertical(start, rawEnd, overlay, perspective) : rawEnd;
    return {
      id: 'pending',
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      width: settings.lineWidth,
      style: settings.lineStyle,
      color: settings.lineColor,
    };
  }

  function onGrant(e: GestureResponderEvent) {
    drawStart.current = toUnits(e);
    setPending(null);
  }

  function onMove(e: GestureResponderEvent) {
    const start = drawStart.current;
    if (!start) return;
    setPending(lineFrom(start, toUnits(e)));
  }

  function onRelease(e: GestureResponderEvent) {
    const start = drawStart.current;
    drawStart.current = null;
    setPending(null);
    if (!start) return;
    const line = lineFrom(start, toUnits(e));
    if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < MIN_LINE_LENGTH) return;
    setLines((prev) => [...prev, { ...line, id: makeId() }]);
    setDirty(true);
  }

  function onTerminate() {
    drawStart.current = null;
    setPending(null);
  }

  function undo() {
    if (lines.length === 0) return;
    setLines((prev) => prev.slice(0, -1));
    setDirty(true);
  }

  function clearAll() {
    if (lines.length === 0) return;
    Alert.alert('Clear all lines?', 'This removes every line you drew on this photo.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear all',
        style: 'destructive',
        onPress: () => {
          setLines([]);
          setDirty(true);
        },
      },
    ]);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      if (photo) {
        await updatePhotoLines(photo.id, lines);
      } else if (editingDraft) {
        const id = await saveDraft(editingDraft, lines);
        setPhotoId(id);
        setDraft(null);
      }
      setDirty(false);
      flash('SAVED TO GALLERY');
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    const unsaved = dirty || (!photo && editingDraft);
    if (!unsaved) return goToCamera();
    Alert.alert(
      photo ? 'Discard changes?' : 'Discard this photo?',
      photo ? 'Your latest lines have not been saved.' : 'This photo has not been saved to the gallery.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: goToCamera },
      ]
    );
  }

  function onArea(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  }

  const canSave = !saving && (dirty || (!photo && !!editingDraft));

  return (
    <View style={styles.root}>
      <ScreenHeader title="EDITOR" onCamera={leave} />

      <View style={styles.canvasArea} onLayout={onArea}>
        {dispW > 0 && (
          <View style={{ width: dispW, height: dispH }}>
            <Image source={{ uri: base.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <OverlayLayer overlay={overlay} lines={lines} pendingLine={pending} />
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={onGrant}
              onResponderMove={onMove}
              onResponderRelease={onRelease}
              onResponderTerminate={onTerminate}
              onResponderTerminationRequest={() => false}
            />
          </View>
        )}
        {toast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </View>

      <View style={[styles.tools, { paddingBottom: insets.bottom + 8 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Text style={styles.rowLabel}>WIDTH</Text>
          {LINE_WIDTHS.map((opt) => {
            const selected = settings.lineWidth === opt.value;
            return (
              <Pressable
                key={opt.label}
                onPress={() => updateSettings({ lineWidth: opt.value })}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Line width ${opt.label}`}>
                <View style={[styles.widthSample, { height: Math.max(1.5, opt.value / 3) }]} />
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Text style={styles.rowLabel}>STYLE</Text>
          {LINE_STYLES.map((style) => {
            const selected = settings.lineStyle === style;
            return (
              <Pressable
                key={style}
                onPress={() => updateSettings({ lineStyle: style })}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Line style ${style}`}>
                <Svg width={28} height={8}>
                  <Line
                    x1={3}
                    y1={4}
                    x2={25}
                    y2={4}
                    stroke={selected ? BLUE : INK}
                    strokeWidth={2.5}
                    strokeDasharray={dashFor({ style, width: 2.5 })}
                    strokeLinecap={style === 'dashed' ? 'butt' : 'round'}
                  />
                </Svg>
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{style}</Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setVertical((v) => !v)}
            style={[styles.chip, vertical && styles.chipSelected]}
            accessibilityRole="button"
            accessibilityState={{ selected: vertical }}
            accessibilityLabel="Vertical lines">
            <Text style={[styles.chipText, vertical && styles.chipTextSelected]}>
              {vertical
                ? perspective === 3 && overlay.stars.some((s) => s.label === 'VP3')
                  ? '↕ to VP3'
                  : '↕ parallel'
                : '↕ vertical'}
            </Text>
          </Pressable>
        </ScrollView>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Text style={styles.rowLabel}>COLOR</Text>
          {LINE_PALETTE.map((color) => {
            const selected = settings.lineColor === color;
            return (
              <Pressable
                key={color}
                onPress={() => updateSettings({ lineColor: color })}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={`Line color ${color}`}
                style={[styles.swatchRing, selected && { borderColor: BLUE }]}>
                <View style={[styles.swatch, { backgroundColor: color }]} />
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.actions}>
          <LinkButton label="Undo" onPress={undo} disabled={lines.length === 0} />
          <LinkButton label="Clear all" onPress={clearAll} disabled={lines.length === 0} color={DANGER} />
          <Text style={styles.count}>{lines.length} LINE{lines.length === 1 ? '' : 'S'}</Text>
          {saving ? (
            <ActivityIndicator color={BLUE} />
          ) : (
            <LinkButton label="Save" onPress={save} disabled={!canSave} textStyle={styles.saveText} />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  canvasArea: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F5F7' },
  toast: {
    position: 'absolute',
    top: 12,
    backgroundColor: INK,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  toastText: { fontFamily: Fonts.mono, color: WHITE, fontSize: 12, letterSpacing: 1 },
  tools: {
    backgroundColor: WHITE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    paddingTop: 6,
  },
  row: { alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 5 },
  rowLabel: { fontFamily: Fonts.mono, fontSize: 10, color: MUTED, width: 46, letterSpacing: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: HAIRLINE,
  },
  chipSelected: { borderColor: BLUE },
  chipText: { fontFamily: Fonts.sans, fontSize: 13, color: INK },
  chipTextSelected: { color: BLUE, fontWeight: '700', textDecorationLine: 'underline' },
  widthSample: { width: 18, backgroundColor: INK, borderRadius: 2 },
  swatchRing: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: HAIRLINE },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  count: { fontFamily: Fonts.mono, fontSize: 11, color: MUTED },
  saveText: { fontSize: 18, fontWeight: '700' },
});
