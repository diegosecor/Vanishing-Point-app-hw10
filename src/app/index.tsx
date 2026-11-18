import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useIsFocused } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LevelIndicator } from '@/components/level-indicator';
import { OverlayLayer } from '@/components/overlay-layer';
import { LinkButton } from '@/components/ui';
import { BLUE, Fonts, HAIRLINE, INK, MUTED, STAR_COLORS, STAR_LABELS, WHITE } from '@/constants/style';
import { useDeviceTilt } from '@/hooks/use-device-tilt';
import {
  FAN_LINE_COUNT,
  FAR,
  distance,
  distanceToSegment,
  fanEnd,
  framePoint,
  makeId,
  toFrame,
  type HorizonFrame,
} from '@/lib/geometry';
import { photoUri } from '@/lib/storage';
import { OVERLAY_WIDTH, type Overlay, type Point, type StarLabel } from '@/lib/types';
import { useAppStore } from '@/store/app-store';

/** A star on the live view, stored relative to the horizon so it follows tilt. */
type LiveStar = {
  id: string;
  label: StarLabel;
  /** Position along the horizon (px from the horizon origin). */
  t: number;
  /** Offset across the horizon (px, positive = below). Always 0 for VP1/VP2. */
  s: number;
  selectedLine: number | null;
};

/** tan(half field of view) of a typical iPhone main camera, long and short sides of the 4:3 sensor. */
const TAN_HALF_LONG = 0.665;
const TAN_HALF_SHORT = 0.499;
const MAX_ELEVATION = 1.3; // ~75 degrees
const CALIBRATION_STEP = 6;
const STAR_HIT = 32;
const HORIZON_HIT = 30;
const HORIZON_PRIORITY_HIT = 14;
const LINE_HIT = 16;
const MOVE_SLOP = 8;
const LONG_PRESS_MS = 550;

/** Focal length in px for a camera preview that fills the frame (aspect-fill). */
function focalLength(w: number, h: number) {
  // Aspect-fill shows the full sensor along whichever side is relatively longer.
  return h / w >= 4 / 3 ? h / (2 * TAN_HALF_LONG) : w / (2 * TAN_HALF_SHORT);
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { settings, photos, setDraft } = useAppStore();
  const perspective = settings.perspective;
  const [permission, requestPermission] = useCameraPermissions();
  const { tilt, status: motionStatus, isLevel } = useDeviceTilt(focused);

  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState(0);
  const [stars, setStars] = useState<LiveStar[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const askedOnce = useRef(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef<{
    start: Point;
    starId: string | null;
    moved: boolean;
    longPressed: boolean;
    timer: ReturnType<typeof setTimeout> | null;
  } | null>(null);

  // Ask for camera access the first time the app opens.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !askedOnce.current) {
      askedOnce.current = true;
      requestPermission().catch(() => {});
    }
  }, [permission, requestPermission]);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    },
    []
  );

  // ---------- horizon geometry (screen px) ----------
  const { w, h } = size;
  const planar = Math.hypot(tilt.upX, tilt.upY);
  const dir = planar > 1e-3 ? { x: tilt.upY / planar, y: tilt.upX / planar } : { x: 1, y: 0 };
  const normal = { x: -dir.y, y: dir.x };
  const elevation = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, tilt.elevation));
  const dist = w > 0 ? focalLength(w, h) * Math.tan(elevation) + offset : offset;
  const frame: HorizonFrame = {
    origin: { x: w / 2 + normal.x * dist, y: h / 2 + normal.y * dist },
    dir,
    normal,
  };
  const angle = Math.atan2(dir.y, dir.x);

  // Stars beyond the chosen perspective (e.g. after switching 3 → 1) are hidden.
  const allowed = STAR_LABELS.slice(0, perspective) as readonly StarLabel[];
  const visibleStars = stars.filter((s) => allowed.includes(s.label));
  const starPositions = visibleStars.map((s) => ({ star: s, pos: framePoint(frame, s.t, s.s) }));
  const nextLabel = allowed.find((l) => !visibleStars.some((s) => s.label === l)) ?? null;

  const scale = w > 0 ? OVERLAY_WIDTH / w : 1;
  const overlay: Overlay = {
    height: h * scale,
    horizon: {
      x1: (frame.origin.x - dir.x * FAR) * scale,
      y1: (frame.origin.y - dir.y * FAR) * scale,
      x2: (frame.origin.x + dir.x * FAR) * scale,
      y2: (frame.origin.y + dir.y * FAR) * scale,
    },
    stars: starPositions.map(({ star, pos }) => ({
      id: star.id,
      label: star.label,
      color: STAR_COLORS[star.label],
      x: pos.x * scale,
      y: pos.y * scale,
      angle,
      selectedLine: star.selectedLine,
    })),
  };

  // ---------- touch handling ----------
  function flashHint(text: string) {
    setHint(text);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 2200);
  }

  function starAt(p: Point): LiveStar | null {
    let best: LiveStar | null = null;
    let bestD = STAR_HIT;
    for (const { star, pos } of starPositions) {
      const d = distance(p, pos);
      if (d < bestD) {
        best = star;
        bestD = d;
      }
    }
    return best;
  }

  function fanLineAt(p: Point): { starId: string; index: number } | null {
    let best: { starId: string; index: number } | null = null;
    let bestD = LINE_HIT;
    for (const { star, pos } of starPositions) {
      if (distance(p, pos) < STAR_HIT) continue;
      for (let i = 0; i < FAN_LINE_COUNT; i++) {
        const d = distanceToSegment(p, pos, fanEnd(pos, angle, i));
        if (d < bestD) {
          best = { starId: star.id, index: i };
          bestD = d;
        }
      }
    }
    return best;
  }

  function placeStar(p: Point, label: StarLabel) {
    const { t, s } = toFrame(frame, p);
    const star: LiveStar = { id: makeId(), label, t, s: label === 'VP3' ? s : 0, selectedLine: null };
    setStars((prev) => [...prev.filter((x) => allowed.includes(x.label)), star]);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  function handleTap(p: Point) {
    if (starAt(p)) return;
    const across = Math.abs(toFrame(frame, p).s);
    if (nextLabel && across < HORIZON_PRIORITY_HIT) return placeStar(p, nextLabel);
    const line = fanLineAt(p);
    if (line) {
      setStars((prev) =>
        prev.map((s) =>
          s.id === line.starId
            ? { ...s, selectedLine: s.selectedLine === line.index ? null : line.index }
            : s
        )
      );
      Haptics.selectionAsync().catch(() => {});
      return;
    }
    if (nextLabel && (across < HORIZON_HIT || nextLabel === 'VP3')) return placeStar(p, nextLabel);
    if (!nextLabel) {
      flashHint(
        `Max ${perspective} vanishing point${perspective > 1 ? 's' : ''} — change it in the menu`
      );
    } else {
      flashHint(`Tap on the horizon to place ${nextLabel}`);
    }
  }

  function onGrant(e: GestureResponderEvent) {
    const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    const star = starAt(p);
    const g = { start: p, starId: star?.id ?? null, moved: false, longPressed: false, timer: null as ReturnType<typeof setTimeout> | null };
    if (star) {
      g.timer = setTimeout(() => {
        g.longPressed = true;
        g.timer = null;
        setStars((prev) => prev.filter((s) => s.id !== star.id));
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        flashHint(`${star.label} deleted`);
      }, LONG_PRESS_MS);
    }
    gesture.current = g;
  }

  function onMove(e: GestureResponderEvent) {
    const g = gesture.current;
    if (!g || g.longPressed) return;
    const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    if (!g.moved && distance(p, g.start) > MOVE_SLOP) {
      g.moved = true;
      if (g.timer) {
        clearTimeout(g.timer);
        g.timer = null;
      }
    }
    if (g.moved && g.starId) {
      const { t, s } = toFrame(frame, p);
      const id = g.starId;
      setStars((prev) =>
        prev.map((star) => (star.id === id ? { ...star, t, s: star.label === 'VP3' ? s : 0 } : star))
      );
    }
  }

  function onRelease(e: GestureResponderEvent) {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.timer) clearTimeout(g.timer);
    if (!g.moved && !g.longPressed) {
      handleTap({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
    }
  }

  function onTerminate() {
    if (gesture.current?.timer) clearTimeout(gesture.current.timer);
    gesture.current = null;
  }

  // ---------- actions ----------
  async function takePhoto() {
    if (!cameraRef.current || !cameraReady || busy) return;
    setBusy(true);
    try {
      const snapshot = overlay;
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!picture?.uri) throw new Error('The camera did not return a photo.');
      setDraft({ uri: picture.uri, createdAt: Date.now(), perspective, overlay: snapshot });
      router.push({ pathname: '/editor', params: { source: 'draft' } });
    } catch (e) {
      Alert.alert('Could not take the photo', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setSize({ w: width, h: height });
  }

  // ---------- render ----------
  const granted = permission?.granted ?? false;
  const lastPhoto = photos[0];

  let previewContent: React.ReactNode;
  if (!permission) {
    previewContent = (
      <View style={styles.center}>
        <ActivityIndicator color={WHITE} />
      </View>
    );
  } else if (!granted) {
    previewContent = (
      <View style={[styles.center, styles.permissionBox]}>
        <Text style={styles.permissionTitle}>Camera access needed</Text>
        <Text style={styles.permissionText}>
          {permission.canAskAgain
            ? 'Vanishing Point needs the camera to show the live view with the horizon line.'
            : 'Camera access is turned off. Open Settings › Expo Go › Camera and switch it on, then come back.'}
        </Text>
        <LinkButton
          label={permission.canAskAgain ? 'Allow camera' : 'Open Settings'}
          onPress={() =>
            permission.canAskAgain
              ? requestPermission().catch(() => {})
              : Linking.openSettings().catch(() => {})
          }
          style={{ marginTop: 18 }}
        />
      </View>
    );
  } else {
    previewContent = (
      <>
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          facing="back"
          mode="picture"
          active={focused}
          animateShutter
          onCameraReady={() => {
            setCameraReady(true);
            setCameraError(null);
          }}
          onMountError={(e) => setCameraError(e.message || 'The camera could not start.')}
        />
        {w > 0 && <OverlayLayer overlay={overlay} />}
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
        {cameraError && (
          <View style={[styles.center, styles.permissionBox]} pointerEvents="none">
            <Text style={styles.permissionTitle}>Camera unavailable</Text>
            <Text style={styles.permissionText}>{cameraError}</Text>
          </View>
        )}
      </>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.preview} onLayout={onLayout}>
        {previewContent}

        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="none">
          <LevelIndicator roll={tilt.roll} isLevel={isLevel} active={motionStatus === 'ok'} />
          {(motionStatus === 'denied' || motionStatus === 'unavailable') && (
            <Text style={styles.motionWarning}>
              {motionStatus === 'denied'
                ? 'Motion access is off, so the horizon can’t follow tilt. Enable Motion & Fitness for Expo Go in Settings.'
                : 'Motion sensor unavailable — use the arrows to place the horizon.'}
            </Text>
          )}
        </View>

        {granted && (
          <View style={styles.hintWrap} pointerEvents="none">
            <Text style={styles.hint}>
              {hint ??
                (nextLabel
                  ? `TAP THE HORIZON TO PLACE ${nextLabel}`
                  : 'DRAG A STAR TO MOVE · HOLD TO DELETE')}
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable
          style={styles.thumb}
          onPress={() => router.push('/gallery')}
          accessibilityRole="button"
          accessibilityLabel="Open gallery">
          {lastPhoto ? (
            <Image source={{ uri: photoUri(lastPhoto.fileName) }} style={styles.thumbImage} contentFit="cover" />
          ) : (
            <Text style={styles.thumbEmpty}>GALLERY</Text>
          )}
        </Pressable>

        <View style={styles.arrows}>
          <Pressable
            style={styles.arrowBtn}
            onPress={() => setOffset((o) => o - CALIBRATION_STEP)}
            accessibilityRole="button"
            accessibilityLabel="Move horizon up">
            <Text style={styles.arrowText}>▲</Text>
          </Pressable>
          <Pressable
            style={styles.arrowBtn}
            onPress={() => setOffset((o) => o + CALIBRATION_STEP)}
            accessibilityRole="button"
            accessibilityLabel="Move horizon down">
            <Text style={styles.arrowText}>▼</Text>
          </Pressable>
        </View>

        <Pressable
          onPress={takePhoto}
          disabled={!granted || !cameraReady || busy}
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          style={({ pressed }) => [
            styles.shutter,
            { opacity: !granted || !cameraReady ? 0.35 : pressed || busy ? 0.6 : 1 },
          ]}>
          <View style={styles.shutterInner}>{busy && <ActivityIndicator color={WHITE} />}</View>
        </Pressable>

        <View style={styles.sideCol}>
          <LinkButton label="Reset" onPress={() => setOffset(0)} accessibilityLabel="Reset horizon" />
          <Text style={styles.offsetText}>{offset === 0 ? 'AUTO' : `${offset > 0 ? '+' : ''}${offset}px`}</Text>
        </View>

        <Pressable
          style={styles.menuBtn}
          onPress={() => router.push('/perspective')}
          accessibilityRole="button"
          accessibilityLabel="Perspective menu">
          <Text style={styles.menuNumber}>{perspective}</Text>
          <Text style={styles.menuLabel}>POINT{perspective > 1 ? 'S' : ''}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  permissionBox: { padding: 32, backgroundColor: '#000' },
  permissionTitle: { fontFamily: Fonts.sans, fontSize: 22, fontWeight: '700', color: WHITE, textAlign: 'center' },
  permissionText: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: '#C9CDD3',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
  },
  topBar: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8 },
  motionWarning: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: WHITE,
    backgroundColor: 'rgba(0,0,0,0.6)',
    padding: 8,
    borderRadius: 8,
    textAlign: 'center',
    overflow: 'hidden',
  },
  hintWrap: { position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' },
  hint: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: WHITE,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
  },
  bottomBar: {
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
  },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F4F5F7',
  },
  thumbImage: { width: '100%', height: '100%' },
  thumbEmpty: { fontFamily: Fonts.mono, fontSize: 8, color: MUTED, letterSpacing: 0.5 },
  arrows: { gap: 4 },
  arrowBtn: {
    width: 40,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: HAIRLINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowText: { color: BLUE, fontSize: 13 },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: INK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideCol: { alignItems: 'center', width: 54 },
  offsetText: { fontFamily: Fonts.mono, fontSize: 9, color: MUTED, marginTop: 2 },
  menuBtn: {
    width: 54,
    height: 54,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuNumber: { fontFamily: Fonts.mono, fontSize: 20, fontWeight: '700', color: BLUE },
  menuLabel: { fontFamily: Fonts.mono, fontSize: 8, color: BLUE, textDecorationLine: 'underline' },
});
