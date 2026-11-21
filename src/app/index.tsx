import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
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

import { Icon } from '@/components/icons';
import { LEVEL_BOX_WIDTH, LevelIndicator } from '@/components/level-indicator';
import { OverlayLayer } from '@/components/overlay-layer';
import { RotatedScreen, RotatingView } from '@/components/rotating';
import { LinkButton } from '@/components/ui';
import { BLUE, Fonts, HAIRLINE, INK, MUTED, STAR_COLORS, STAR_LABELS, WHITE } from '@/constants/style';
import { useDeviceTilt } from '@/hooks/use-device-tilt';
import { FAN_LINE_COUNT, distance, distanceToSegment, fanAngle, makeId, timestamp } from '@/lib/geometry';
import {
  clipLine,
  clipRay,
  cross,
  normalize,
  planeLine,
  project,
  unproject,
  type Camera,
  type Vec3,
} from '@/lib/projection';
import { photoUri } from '@/lib/storage';
import { OVERLAY_WIDTH, type Guide, type Overlay, type Point, type StarLabel } from '@/lib/types';
import { useAppStore } from '@/store/app-store';

/** A vanishing point fixed to a direction in the world (compass + gravity). */
type LiveStar = {
  id: string;
  label: StarLabel;
  /** World direction of the vanishing point. VP1/VP2 are horizontal (on the horizon). */
  dir: Vec3;
  /** Indexes of the selected guide lines (several allowed). */
  selected: number[];
  /** User lines: each passes through the point and through this world direction. */
  custom: Vec3[];
};

type Seg = { x1: number; y1: number; x2: number; y2: number };

/** tan(half field of view) of a typical iPhone main camera, long and short sides of the 4:3 sensor. */
const TAN_HALF_LONG = 0.665;
const TAN_HALF_SHORT = 0.499;
const CALIBRATION_STEP = 6;
const STAR_HIT = 32;
const HORIZON_HIT = 30;
const HORIZON_PRIORITY_HIT = 14;
const LINE_HIT = 14;
const MOVE_SLOP = 8;
const LONG_PRESS_MS = 550;
const UP: Vec3 = [0, 0, 1];

/** Lens choices, like the iPhone camera app. 2x is a center crop of the main lens. */
type Lens = '0.5' | '1' | '2';
/** Focal length relative to the main (1x) lens. */
const LENS_SCALE: Record<Lens, number> = { '0.5': 0.5, '1': 1, '2': 2 };
const ULTRA_WIDE = 'UltraWide';

/** Focal length in px for a camera preview that fills the frame (aspect-fill). */
function focalLength(w: number, h: number) {
  return h / w >= 4 / 3 ? h / (2 * TAN_HALF_LONG) : w / (2 * TAN_HALF_SHORT);
}

export default function CameraScreen() {
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();
  const { settings, photos, setDraft } = useAppStore();
  const perspective = settings.perspective;
  const [permission, requestPermission] = useCameraPermissions();
  const { tilt, status: motionStatus, portraitLevel, landscapeLevel, uiRotation } = useDeviceTilt(focused);

  const cameraRef = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [offset, setOffset] = useState(0);
  const [stars, setStars] = useState<LiveStar[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>('1');
  /** deviceType of the 0.5x ultra-wide lens, when the phone has one. */
  const [ultraWide, setUltraWide] = useState<string | null>(null);
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
    [],
  );

  // ---------- projection (screen px) ----------
  const { w, h } = size;
  const rect = { w, h };
  const base: Camera = {
    R: tilt.R,
    f: w > 0 ? focalLength(w, h) * LENS_SCALE[lens] : 1,
    cx: w / 2,
    cy: h / 2,
    shift: { x: 0, y: 0 },
  };
  const rawHorizon = planeLine(base, UP);
  const normal = rawHorizon ? { x: -rawHorizon.dir.y, y: rawHorizon.dir.x } : { x: 0, y: 1 };
  const cam: Camera = { ...base, shift: { x: normal.x * offset, y: normal.y * offset } };
  const horizon = planeLine(cam, UP);
  const horizonAngle = horizon ? Math.atan2(horizon.dir.y, horizon.dir.x) : tilt.roll;

  // Points beyond the chosen perspective (e.g. after switching 3 → 1) are hidden.
  const allowed = STAR_LABELS.slice(0, perspective) as readonly StarLabel[];
  const visibleStars = stars.filter((s) => allowed.includes(s.label));
  const nextLabel = allowed.find((l) => !visibleStars.some((s) => s.label === l)) ?? null;
  const active = visibleStars.find((s) => s.id === activeId) ?? visibleStars[visibleStars.length - 1] ?? null;

  const projected = visibleStars.map((star) => {
    const { point, inFront } = project(cam, star.dir);
    const onScreen = inFront && point.x >= 0 && point.x <= w && point.y >= 0 && point.y <= h;
    const fan: (Seg & { index: number })[] = [];
    for (let i = 0; i < FAN_LINE_COUNT; i++) {
      const a = fanAngle(horizonAngle, i);
      const seg = clipRay(point, { x: Math.cos(a), y: Math.sin(a) }, rect);
      if (seg) fan.push({ ...seg, index: i });
    }
    const custom: Seg[] = [];
    for (const through of star.custom) {
      const n = normalize(cross(star.dir, through));
      const line = n && planeLine(cam, n);
      const seg = line && clipLine(line.p, line.dir, rect);
      if (seg) custom.push(seg);
    }
    return { star, point, inFront, onScreen, fan, custom };
  });

  const k = w > 0 ? OVERLAY_WIDTH / w : 1;
  const scaleSeg = (s: Seg) => ({ x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k });
  const guides: Guide[] = [];
  for (const { star, fan, custom } of projected) {
    const color = STAR_COLORS[star.label];
    const hasSelection = star.selected.length > 0;
    for (const seg of fan) {
      const selected = star.selected.includes(seg.index);
      guides.push({
        ...scaleSeg(seg),
        color,
        width: selected ? 7.5 : 2.5,
        opacity: hasSelection && !selected ? 0.22 : 0.85,
        starId: star.id,
      });
    }
    for (const seg of custom) guides.push({ ...scaleSeg(seg), color, width: 5, opacity: 1, starId: star.id });
  }
  const overlay: Overlay = {
    height: h * k,
    horizon: horizon
      ? {
          x1: (horizon.p.x - horizon.dir.x * 20000) * k,
          y1: (horizon.p.y - horizon.dir.y * 20000) * k,
          x2: (horizon.p.x + horizon.dir.x * 20000) * k,
          y2: (horizon.p.y + horizon.dir.y * 20000) * k,
        }
      : null,
    stars: projected.map(({ star, point, onScreen }) => ({
      id: star.id,
      label: star.label,
      color: STAR_COLORS[star.label],
      x: point.x * k,
      y: point.y * k,
      visible: onScreen,
    })),
    guides,
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
    for (const { star, point, onScreen } of projected) {
      if (!onScreen) continue;
      const d = distance(p, point);
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
    for (const { star, point, fan } of projected) {
      if (distance(p, point) < STAR_HIT) continue;
      for (const seg of fan) {
        const d = distanceToSegment(p, { x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
        if (d < bestD) {
          best = { starId: star.id, index: seg.index };
          bestD = d;
        }
      }
    }
    return best;
  }

  function horizonDistance(p: Point) {
    if (!horizon) return Infinity;
    return Math.abs((p.x - horizon.p.x) * horizon.dir.y - (p.y - horizon.p.y) * horizon.dir.x);
  }

  /** Direction for a point at screen p; VP1/VP2 are forced onto the horizon. */
  function directionFor(p: Point, label: StarLabel): Vec3 | null {
    const d = unproject(cam, p);
    return label === 'VP3' ? d : normalize([d[0], d[1], 0]);
  }

  function placeStar(p: Point, label: StarLabel) {
    const dir = directionFor(p, label);
    if (!dir) return flashHint('Point the camera at the horizon');
    const star: LiveStar = { id: makeId(), label, dir, selected: [], custom: [] };
    setStars((prev) => [...prev.filter((x) => allowed.includes(x.label)), star]);
    setActiveId(star.id);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }

  function addCustomLine(p: Point, star: LiveStar) {
    const through = unproject(cam, p);
    if (!normalize(cross(star.dir, through))) return;
    setStars((prev) => prev.map((s) => (s.id === star.id ? { ...s, custom: [...s.custom, through] } : s)));
    Haptics.selectionAsync().catch(() => {});
  }

  function handleTap(p: Point) {
    const hit = starAt(p);
    if (hit) {
      setActiveId(hit.id);
      Haptics.selectionAsync().catch(() => {});
      return;
    }
    const across = horizonDistance(p);
    if (nextLabel && across < HORIZON_PRIORITY_HIT) return placeStar(p, nextLabel);
    const line = fanLineAt(p);
    if (line) {
      setStars((prev) =>
        prev.map((s) =>
          s.id === line.starId
            ? {
                ...s,
                selected: s.selected.includes(line.index)
                  ? s.selected.filter((i) => i !== line.index)
                  : [...s.selected, line.index],
              }
            : s,
        ),
      );
      setActiveId(line.starId);
      Haptics.selectionAsync().catch(() => {});
      return;
    }
    if (nextLabel && (across < HORIZON_HIT || nextLabel === 'VP3')) return placeStar(p, nextLabel);
    if (active) return addCustomLine(p, active);
    flashHint(nextLabel ? `Tap on the horizon to place ${nextLabel}` : 'Choose a point below');
  }

  function deleteStar(id: string, label: StarLabel) {
    setStars((prev) => prev.filter((s) => s.id !== id));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    flashHint(`${label} deleted`);
  }

  function onGrant(e: GestureResponderEvent) {
    const p = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
    const star = starAt(p);
    const g = {
      start: p,
      starId: star?.id ?? null,
      moved: false,
      longPressed: false,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    if (star) {
      g.timer = setTimeout(() => {
        g.longPressed = true;
        g.timer = null;
        deleteStar(star.id, star.label);
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
      const id = g.starId;
      setStars((prev) =>
        prev.map((star) => {
          if (star.id !== id) return star;
          const dir = directionFor(p, star.label);
          return dir ? { ...star, dir } : star;
        }),
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

  function rememberLenses(lenses: { deviceType: string }[]) {
    setUltraWide(lenses.find((l) => l.deviceType.includes(ULTRA_WIDE))?.deviceType ?? null);
  }

  /** The 2x lens shows the center of the main lens, so the photo is cropped the same way. */
  async function cropCenter(uri: string): Promise<string> {
    const full = await ImageManipulator.manipulate(uri).renderAsync();
    const cw = Math.round(full.width / 2);
    const ch = Math.round(full.height / 2);
    const cropped = await ImageManipulator.manipulate(full)
      .crop({ originX: Math.round(full.width / 4), originY: Math.round(full.height / 4), width: cw, height: ch })
      .renderAsync();
    const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
    return saved.uri;
  }

  // ---------- actions ----------
  async function takePhoto() {
    if (!cameraRef.current || !cameraReady || busy) return;
    setBusy(true);
    try {
      const snapshot = overlay;
      const picture = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (!picture?.uri) throw new Error('The camera did not return a photo.');
      const uri = lens === '2' ? await cropCenter(picture.uri) : picture.uri;
      setDraft({ uri, createdAt: timestamp(), perspective, overlay: snapshot });
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
  const motionOk = motionStatus === 'ok';
  const sideRotation = uiRotation !== 0 ? uiRotation : 90;
  const hintText =
    hint ??
    (nextLabel
      ? `TAP THE HORIZON TO PLACE ${nextLabel}`
      : active
        ? `TAP TO ADD A LINE FROM ${active.label} · HOLD POINT TO DELETE`
        : '');

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
        <View style={[StyleSheet.absoluteFill, lens === '2' && styles.zoom2]}>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="picture"
            active={focused}
            animateShutter
            responsiveOrientationWhenOrientationLocked={false}
            selectedLens={lens === '0.5' && ultraWide ? ultraWide : undefined}
            onAvailableLensesChanged={(e) => rememberLenses(e.lenses)}
            onCameraReady={() => {
              setCameraReady(true);
              setCameraError(null);
              cameraRef.current
                ?.getAvailableLensesAsync()
                .then(rememberLenses)
                .catch(() => {});
            }}
            onMountError={(e) => setCameraError(e.message || 'The camera could not start.')}
          />
        </View>
        {w > 0 && <OverlayLayer overlay={overlay} activeStarId={active?.id} labelRotation={uiRotation} />}
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

        {/* Portrait level (top) */}
        <View style={[styles.topBar, { top: insets.top + 8 }]} pointerEvents="none">
          <LevelIndicator
            deviation={tilt.roll}
            horizonAngle={horizonAngle}
            isLevel={portraitLevel}
            active={motionOk}
          />
          {(motionStatus === 'denied' || motionStatus === 'unavailable') && (
            <Text style={styles.motionWarning}>
              {motionStatus === 'denied'
                ? 'Motion access is off, so the horizon can’t follow the phone. Enable Motion & Fitness for Expo Go in Settings.'
                : 'Motion sensor unavailable — use the arrows to place the horizon.'}
            </Text>
          )}
        </View>

        {/* Landscape level (right side) */}
        <View style={styles.sideLevel} pointerEvents="none">
          <LevelIndicator
            deviation={tilt.landscapeRoll}
            horizonAngle={horizonAngle}
            isLevel={landscapeLevel}
            active={motionOk}
            rotation={sideRotation}
          />
        </View>

        {granted && (
          <View style={styles.lensRow}>
            {(['0.5', '1', '2'] as Lens[])
              .filter((l) => l !== '0.5' || ultraWide)
              .map((l) => {
                const on = lens === l;
                return (
                  <Pressable
                    key={l}
                    onPress={() => setLens(l)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${l}x lens`}
                    style={[styles.lensBtn, on && styles.lensBtnOn]}
                  >
                    <RotatingView rotation={uiRotation}>
                      <Text style={[styles.lensText, on && styles.lensTextOn]}>
                        {l === '0.5' ? '.5' : l}
                        {on ? '×' : ''}
                      </Text>
                    </RotatingView>
                  </Pressable>
                );
              })}
          </View>
        )}

        {granted && hintText !== '' && (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <RotatedScreen rotation={uiRotation}>
              <View style={styles.hintWrap}>
                <Text style={styles.hint}>{hintText}</Text>
              </View>
            </RotatedScreen>
          </View>
        )}
      </View>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
        {/* Vanishing point selector */}
        <View style={styles.chipRow}>
          {allowed.map((label) => {
            const star = visibleStars.find((s) => s.label === label);
            const isActive = !!star && star.id === active?.id;
            return (
              <Pressable
                key={label}
                onPress={() => {
                  if (star) setActiveId(star.id);
                  else flashHint(`Tap the horizon to place ${label}`);
                }}
                onLongPress={() => star && deleteStar(star.id, star.label)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={star ? `Select ${label}, hold to delete` : `${label} not placed`}
                style={[
                  styles.chip,
                  star
                    ? {
                        backgroundColor: STAR_COLORS[label],
                        borderColor: isActive ? BLUE : STAR_COLORS[label],
                      }
                    : styles.chipEmpty,
                  isActive && styles.chipActive,
                ]}
              >
                <RotatingView rotation={uiRotation}>
                  <Text style={[styles.chipText, !star && styles.chipTextEmpty]}>{label}</Text>
                </RotatingView>
              </Pressable>
            );
          })}
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() => router.push('/info')}
            accessibilityRole="button"
            accessibilityLabel="How perspective works"
            style={({ pressed }) => [styles.infoBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <RotatingView rotation={uiRotation} style={styles.infoInner}>
              <Icon name="info" size={20} color={WHITE} />
              <Text style={styles.infoText}>LEARN</Text>
            </RotatingView>
          </Pressable>
        </View>

        <View style={styles.mainRow}>
          <Pressable
            style={styles.thumb}
            onPress={() => router.push('/gallery')}
            accessibilityRole="button"
            accessibilityLabel="Open gallery"
          >
            <RotatingView rotation={uiRotation} style={styles.thumbInner}>
              {lastPhoto ? (
                <Image
                  source={{ uri: photoUri(lastPhoto.fileName) }}
                  style={styles.thumbImage}
                  contentFit="cover"
                />
              ) : (
                <Text style={styles.thumbEmpty}>GALLERY</Text>
              )}
            </RotatingView>
          </Pressable>

          <View style={styles.arrows}>
            <Pressable
              style={styles.arrowBtn}
              onPress={() => setOffset((o) => o - CALIBRATION_STEP)}
              accessibilityRole="button"
              accessibilityLabel="Move horizon up"
            >
              <RotatingView rotation={uiRotation}>
                <Icon name="up" size={16} />
              </RotatingView>
            </Pressable>
            <Pressable
              style={styles.arrowBtn}
              onPress={() => setOffset((o) => o + CALIBRATION_STEP)}
              accessibilityRole="button"
              accessibilityLabel="Move horizon down"
            >
              <RotatingView rotation={uiRotation}>
                <Icon name="down" size={16} />
              </RotatingView>
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
            ]}
          >
            <View style={styles.shutterInner}>{busy && <ActivityIndicator color={WHITE} />}</View>
          </Pressable>

          <RotatingView rotation={uiRotation} style={styles.sideCol}>
            <LinkButton label="Reset" onPress={() => setOffset(0)} accessibilityLabel="Reset horizon" />
            <Text style={styles.offsetText}>
              {offset === 0 ? 'AUTO' : `${offset > 0 ? '+' : ''}${offset}px`}
            </Text>
          </RotatingView>

          <Pressable
            style={styles.menuBtn}
            onPress={() => router.push('/perspective')}
            accessibilityRole="button"
            accessibilityLabel="Perspective menu"
          >
            <RotatingView rotation={uiRotation} style={styles.menuInner}>
              <Text style={styles.menuNumber}>{perspective}</Text>
              <Text style={styles.menuLabel}>POINT{perspective > 1 ? 'S' : ''}</Text>
            </RotatingView>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: '#000' },
  center: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  permissionBox: { padding: 32, backgroundColor: '#000' },
  permissionTitle: {
    fontFamily: Fonts.sans,
    fontSize: 22,
    fontWeight: '700',
    color: WHITE,
    textAlign: 'center',
  },
  permissionText: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    color: '#C9CDD3',
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 21,
  },
  topBar: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8 },
  sideLevel: {
    position: 'absolute',
    right: 6,
    top: '50%',
    width: 40,
    height: LEVEL_BOX_WIDTH,
    marginTop: -LEVEL_BOX_WIDTH / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  hintWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 64,
    paddingHorizontal: 50,
  },
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
    textAlign: 'center',
  },
  bottomBar: { backgroundColor: WHITE, paddingHorizontal: 18, paddingTop: 10 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  chip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipEmpty: { borderColor: HAIRLINE, borderStyle: 'dashed', backgroundColor: WHITE },
  chipActive: { borderWidth: 3 },
  chipText: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700', color: WHITE },
  chipTextEmpty: { color: MUTED },
  infoBtn: { height: 40, borderRadius: 20, backgroundColor: BLUE, paddingHorizontal: 14, justifyContent: 'center' },
  infoInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoText: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '700', color: WHITE, letterSpacing: 1 },
  zoom2: { transform: [{ scale: 2 }] },
  lensRow: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 22,
    padding: 4,
  },
  lensBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  lensBtnOn: { backgroundColor: 'rgba(0,0,0,0.75)' },
  lensText: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '700', color: WHITE },
  lensTextOn: { color: '#FFC72C', fontSize: 12 },
  mainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  thumb: {
    width: 54,
    height: 54,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
    backgroundColor: '#F4F5F7',
  },
  thumbInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbImage: { width: 54, height: 54 },
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
  menuBtn: { width: 54, height: 54, borderRadius: 8, borderWidth: 1.5, borderColor: BLUE },
  menuInner: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  menuNumber: { fontFamily: Fonts.mono, fontSize: 20, fontWeight: '700', color: BLUE },
  menuLabel: { fontFamily: Fonts.mono, fontSize: 8, color: BLUE, textDecorationLine: 'underline' },
});
