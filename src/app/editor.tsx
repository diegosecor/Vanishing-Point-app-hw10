import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
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
import Svg, { Circle, Line } from 'react-native-svg';

import { Icon, type IconName } from '@/components/icons';
import { OverlayLayer, dashFor } from '@/components/overlay-layer';
import { LinkButton, ScreenHeader, goToCamera, textStyles } from '@/components/ui';
import {
  BLUE,
  DANGER,
  FISHEYE_LABELS,
  Fonts,
  HAIRLINE,
  HORIZON_COLOR,
  INK,
  LINE_PALETTE,
  LINE_STYLES,
  LINE_WIDTHS,
  MUTED,
  STAR_COLORS,
  STAR_LABELS,
  WHITE,
  textOn,
} from '@/constants/style';
import {
  addStar as addStarTo,
  anchorOf,
  attachedCount,
  contentBounds,
  defaultHorizon,
  drag,
  dragHandle,
  exists,
  extensionsFor,
  finalizeOverlay,
  handlesOf,
  hitHandle,
  hitTest,
  horizonHandles,
  pushStar as pushStarDoc,
  remove,
  type EditDoc,
  type Selection,
} from '@/lib/edit';
import { makeId } from '@/lib/geometry';
import { clipLine, clipRay } from '@/lib/projection';
import { photoUri } from '@/lib/storage';
import { OVERLAY_WIDTH, type DrawnLine, type Overlay, type Point, type SavedStar, type StarLabel } from '@/lib/types';
import { useAppStore } from '@/store/app-store';

const MIN_LINE_LENGTH = 8; // overlay units
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;
/** How far (screen px) a finger must move before a press becomes a drag. */
const DRAG_SLOP = 4;
/** Points must be held this long before they can be dragged, so they don't move by accident. */
const POINT_HOLD_MS = 400;
/** Moving more than this (px) before the hold completes pans the view instead. */
const POINT_HOLD_SLOP = 10;
/** With MOVE on, points move at half the finger speed, for precision. */
const PRECISE = 0.5;
const HISTORY_LIMIT = 60;
const EMPTY_OVERLAY: Overlay = { height: 1, horizon: null, stars: [], guides: [] };

/** Drawing tools; any other mode value is the id of the point lines start from. */
type Tool = 'vertical' | 'free' | 'arc' | 'brush' | 'edit';
const TOOLS: Tool[] = ['vertical', 'free', 'arc', 'brush', 'edit'];

type Zoom = { s: number; tx: number; ty: number };
type Gesture =
  | { kind: 'none' }
  | { kind: 'draw'; start: Point }
  | { kind: 'brush'; points: Point[] }
  | { kind: 'pinch'; s0: number; t0: Point; d0: number; c0: Point }
  | { kind: 'pan'; p0: Point; t0: Point; moved: boolean }
  | {
      kind: 'drag';
      sel: Selection;
      /** Which handle is dragged (index from handlesOf), 'body' to move the whole thing. */
      part: number | 'body';
      p0: Point;
      before: EditDoc;
      moved: boolean;
      /** True until a point has been held long enough to be dragged. */
      locked: boolean;
      /** Finger-to-item speed (MOVE mode moves points at half speed). */
      factor: number;
    };

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

function unitVec(dx: number, dy: number): Point | null {
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? null : { x: dx / len, y: dy / len };
}

/** Button that repeats (and speeds up) while held. */
function RepeatButton({
  label,
  onStart,
  onStep,
  disabled,
  accessibilityLabel,
}: {
  label: string;
  onStart: () => void;
  onStep: (tick: number) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef(0);

  function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function run() {
    onStep(tick.current);
    tick.current += 1;
    timer.current = setTimeout(run, tick.current === 1 ? 350 : 60);
  }

  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => {
        stop();
        tick.current = 0;
        onStart();
        run();
      }}
      onPressOut={stop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.outlineBtn, { opacity: disabled ? 0.3 : pressed ? 0.5 : 1 }]}
    >
      <Text style={styles.outlineBtnText}>{label}</Text>
    </Pressable>
  );
}

function ToolChip({
  label,
  icon,
  on,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  icon?: IconName;
  on: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, on && styles.chipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={accessibilityLabel}
    >
      {icon && <Icon name={icon} size={16} color={on ? BLUE : INK} />}
      <Text style={[styles.chipText, on && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function EditorScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id?: string; source?: string }>();
  const { photos, draft, settings, updateSettings, saveDraft, updatePhotoEdits, setDraft } = useAppStore();

  const [photoId, setPhotoId] = useState<string | null>(typeof params.id === 'string' ? params.id : null);
  const photo = photoId ? photos.find((p) => p.id === photoId) : undefined;
  const editingDraft = !photoId && params.source === 'draft' ? draft : null;

  const base = photo
    ? { uri: photoUri(photo.fileName), overlay: photo.overlay, perspective: photo.perspective }
    : editingDraft
      ? { uri: editingDraft.uri, overlay: editingDraft.overlay, perspective: editingDraft.perspective }
      : null;

  const [doc, setDoc] = useState<EditDoc>(() => ({
    lines: photo?.lines ?? [],
    overlay: base?.overlay ?? EMPTY_OVERLAY,
  }));
  const [history, setHistory] = useState<EditDoc[]>([]);
  // A photo without points (e.g. imported from the camera roll) starts in Adjust mode to add them.
  const [mode, setMode] = useState<string>(
    () => base?.overlay.stars.find((st) => !st.label.startsWith('FE'))?.id ?? 'edit',
  );
  const [sel, setSel] = useState<Selection | null>(null);
  const [moveOn, setMoveOn] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<DrawnLine | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>({ s: 1, tx: 0, ty: 0 });
  const [toast, setToast] = useState<string | null>(() =>
    base && base.overlay.stars.length === 0 ? 'TAP + VP1 TO ADD A VANISHING POINT' : null,
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gesture = useRef<Gesture>({ kind: 'none' });
  /** Page position of the canvas, so every finger can be converted to canvas coordinates. */
  const origin = useRef<Point>({ x: 0, y: 0 });
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    toastTimer.current = setTimeout(() => setToast(null), 3500);
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, []);

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

  const { overlay, lines } = doc;
  const aspect = OVERLAY_WIDTH / overlay.height;
  const W = area.w;
  const H = area.h;
  const dispW = W > 0 ? Math.min(W, H * aspect) : 0;
  const dispH = dispW / aspect;
  /** Overlay units per screen pixel at zoom 1. */
  const b = dispW > 0 ? OVERLAY_WIDTH / dispW : 1;
  const ox = (W - dispW) / 2;
  const oy = (H - dispH) / 2;
  const { s, tx, ty } = zoom;
  const unitsPerPx = b / s;
  const viewBox = `${(-ox - tx) * unitsPerPx} ${(-oy - ty) * unitsPerPx} ${W * unitsPerPx} ${H * unitsPerPx}`;
  const rect = { w: OVERLAY_WIDTH, h: overlay.height };

  const editing = mode === 'edit';
  const tool: Tool | null = TOOLS.includes(mode as Tool) ? (mode as Tool) : null;
  const fromStar = tool ? null : (overlay.stars.find((st) => st.id === mode) ?? null);
  const vp3 = overlay.stars.find((st) => st.label === 'VP3');
  const fe1 = overlay.stars.find((st) => st.label === 'FE1');
  const fe2 = overlay.stars.find((st) => st.label === 'FE2');
  const selected = sel && exists(doc, sel) ? sel : null;
  const selectedLine = selected?.kind === 'line' ? (lines.find((l) => l.id === selected.id) ?? null) : null;

  // ---------- coordinates ----------
  const toUnits = (p: Point): Point => ({ x: (p.x - ox - tx) * unitsPerPx, y: (p.y - oy - ty) * unitsPerPx });
  const toScreen = (u: Point): Point => ({ x: ox + tx + u.x / unitsPerPx, y: oy + ty + u.y / unitsPerPx });

  function canvasPoint(t: { pageX: number; pageY: number }): Point {
    return { x: t.pageX - origin.current.x, y: t.pageY - origin.current.y };
  }

  /** Keeps at least part of the photo (and its points) on screen. */
  function clampZoom(z: Zoom): Zoom {
    const box = contentBounds(overlay, overlay.stars);
    const k = z.s / b;
    const margin = 60;
    let nx = z.tx;
    let ny = z.ty;
    const left = ox + nx + box.minX * k;
    const right = ox + nx + box.maxX * k;
    if (right < margin) nx += margin - right;
    if (left > W - margin) nx -= left - (W - margin);
    const top = oy + ny + box.minY * k;
    const bottom = oy + ny + box.maxY * k;
    if (bottom < margin) ny += margin - bottom;
    if (top > H - margin) ny -= top - (H - margin);
    return { s: z.s, tx: nx, ty: ny };
  }

  function zoomAround(c: Point, nextScale: number) {
    const ns = clampScale(nextScale);
    const qx = (c.x - ox - tx) / s;
    const qy = (c.y - oy - ty) / s;
    setZoom(clampZoom({ s: ns, tx: c.x - ox - ns * qx, ty: c.y - oy - ns * qy }));
  }

  /** Zooms out until the photo and the given points fit on screen. */
  function fitTo(points: Point[]) {
    const box = contentBounds(overlay, points);
    const bw = (box.maxX - box.minX) / b;
    const bh = (box.maxY - box.minY) / b;
    const ns = clampScale(Math.min(1, Math.min(W / bw, H / bh) * 0.9));
    const cx = (box.minX + box.maxX) / 2 / b;
    const cy = (box.minY + box.maxY) / 2 / b;
    setZoom({ s: ns, tx: W / 2 - ox - ns * cx, ty: H / 2 - oy - ns * cy });
  }

  function onScreen(u: Point): boolean {
    const p = toScreen(u);
    return p.x > 20 && p.x < W - 20 && p.y > 20 && p.y < H - 20;
  }

  // ---------- document changes ----------
  function flash(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  function remember(snapshot: EditDoc) {
    setHistory((h) => [...h.slice(-(HISTORY_LIMIT - 1)), snapshot]);
    setDirty(true);
  }

  function commit(next: EditDoc) {
    remember(doc);
    setDoc(next);
  }

  function styled(seg: { x1: number; y1: number; x2: number; y2: number }): DrawnLine {
    return {
      id: 'pending',
      ...seg,
      width: settings.lineWidth,
      style: settings.lineStyle,
      color: settings.lineColor,
    };
  }

  /** From a point, through the finger, to the edge of the photo. */
  function lineFromStar(star: SavedStar, touch: Point): DrawnLine | null {
    const d = unitVec(touch.x - star.x, touch.y - star.y);
    if (!d) return null;
    const inside = star.x >= 0 && star.x <= OVERLAY_WIDTH && star.y >= 0 && star.y <= overlay.height;
    // A point inside the photo gets a line through it in both directions.
    const seg = inside ? clipLine(star, d, rect) : clipRay(star, d, rect);
    return seg ? { ...styled(seg), starId: star.id } : null;
  }

  /** Vertical through the finger: toward VP3 when there is one, otherwise square to the horizon. */
  function verticalAt(touch: Point): DrawnLine | null {
    if (vp3) return lineFromStar(vp3, touch);
    const h = overlay.horizon;
    const d = (h && unitVec(-(h.y2 - h.y1), h.x2 - h.x1)) || { x: 0, y: 1 };
    const seg = clipLine(touch, d, rect);
    return seg ? styled(seg) : null;
  }

  function arcAt(touch: Point): DrawnLine | null {
    if (!fe1 || !fe2) return null;
    return {
      ...styled({ x1: fe1.x, y1: fe1.y, x2: fe2.x, y2: fe2.y }),
      kind: 'arc',
      via: touch,
      starId: fe1.id,
      starId2: fe2.id,
    };
  }

  function lineFrom(start: Point, end: Point): DrawnLine | null {
    if (fromStar) return lineFromStar(fromStar, end);
    if (tool === 'vertical') return verticalAt(end);
    if (tool === 'arc') return arcAt(end);
    return styled({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
  }

  // ---------- touch handling ----------
  function clearHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  function startPinch(touches: readonly { pageX: number; pageY: number }[]) {
    const a = canvasPoint(touches[0]);
    const c = canvasPoint(touches[1]);
    setPending(null);
    clearHold();
    // A drag that turns into a pinch keeps whatever it already moved.
    const g = gesture.current;
    if (g.kind === 'drag' && g.moved) remember(g.before);
    gesture.current = {
      kind: 'pinch',
      s0: s,
      t0: { x: tx, y: ty },
      d0: Math.max(1, Math.hypot(a.x - c.x, a.y - c.y)),
      c0: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 },
    };
  }

  function onGrant(e: GestureResponderEvent) {
    const ne = e.nativeEvent;
    origin.current = { x: ne.pageX - ne.locationX, y: ne.pageY - ne.locationY };
    if (ne.touches.length >= 2) return startPinch(ne.touches);
    const p = canvasPoint(ne);
    const u = toUnits(p);

    if (!editing) {
      if (tool === 'brush') {
        gesture.current = { kind: 'brush', points: [u] };
        setPending({ ...styled({ x1: u.x, y1: u.y, x2: u.x, y2: u.y }), kind: 'stroke', points: [u] });
        return;
      }
      if (tool === 'arc' && (!fe1 || !fe2)) {
        flash('ADD THE FISHEYE POINTS FIRST: ADJUST → + FISHEYE');
        gesture.current = { kind: 'none' };
        return;
      }
      gesture.current = { kind: 'draw', start: u };
      // From a point, vertical or arc, a single tap is enough, so preview right away.
      setPending(tool === 'free' ? null : lineFrom(u, u));
      return;
    }

    // MOVE on: dragging anywhere moves the selection (points at half speed, for precision).
    if (moveOn && selected) {
      const factor = selected.kind === 'star' ? PRECISE : 1;
      gesture.current = {
        kind: 'drag',
        sel: selected,
        part: 'body',
        p0: p,
        before: doc,
        moved: false,
        locked: false,
        factor,
      };
      return;
    }

    if (selected && selected.kind !== 'star') {
      const handle = hitHandle(doc, selected, u, 26 * unitsPerPx);
      if (handle !== null) {
        gesture.current = {
          kind: 'drag',
          sel: selected,
          part: handle,
          p0: p,
          before: doc,
          moved: false,
          locked: false,
          factor: 1,
        };
        return;
      }
    }
    const hit = hitTest(doc, u, 28 * unitsPerPx, 16 * unitsPerPx);
    if (hit) {
      setSel(hit);
      const g: Gesture = {
        kind: 'drag',
        sel: hit,
        part: 'body',
        p0: p,
        before: doc,
        moved: false,
        locked: hit.kind === 'star',
        factor: 1,
      };
      gesture.current = g;
      if (g.locked) {
        clearHold();
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          if (gesture.current !== g) return;
          g.locked = false;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        }, POINT_HOLD_MS);
      }
      return;
    }
    gesture.current = { kind: 'pan', p0: p, t0: { x: tx, y: ty }, moved: false };
  }

  function onMove(e: GestureResponderEvent) {
    const ne = e.nativeEvent;
    const g = gesture.current;
    if (ne.touches.length >= 2) {
      if (g.kind !== 'pinch') return startPinch(ne.touches);
      const a = canvasPoint(ne.touches[0]);
      const c = canvasPoint(ne.touches[1]);
      const d = Math.max(1, Math.hypot(a.x - c.x, a.y - c.y));
      const center = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      const ns = clampScale((g.s0 * d) / g.d0);
      // Keep the photo point that was under the fingers under the fingers.
      const qx = (g.c0.x - ox - g.t0.x) / g.s0;
      const qy = (g.c0.y - oy - g.t0.y) / g.s0;
      setZoom(clampZoom({ s: ns, tx: center.x - ox - ns * qx, ty: center.y - oy - ns * qy }));
      return;
    }
    const p = canvasPoint(ne.touches[0] ?? ne);
    switch (g.kind) {
      case 'draw':
        setPending(lineFrom(g.start, toUnits(p)));
        return;
      case 'brush': {
        const u = toUnits(p);
        const last = g.points[g.points.length - 1];
        if (Math.hypot(u.x - last.x, u.y - last.y) < 2 * unitsPerPx) return;
        g.points.push(u);
        const pts = [...g.points];
        setPending((prev) => (prev ? { ...prev, points: pts, x2: u.x, y2: u.y } : prev));
        return;
      }
      case 'pan': {
        if (!g.moved && Math.hypot(p.x - g.p0.x, p.y - g.p0.y) < DRAG_SLOP) return;
        g.moved = true;
        setZoom(clampZoom({ s, tx: g.t0.x + p.x - g.p0.x, ty: g.t0.y + p.y - g.p0.y }));
        return;
      }
      case 'drag': {
        if (g.locked) {
          // Moved before the hold finished: pan the view and leave the point where it is.
          if (Math.hypot(p.x - g.p0.x, p.y - g.p0.y) < POINT_HOLD_SLOP) return;
          clearHold();
          flash('HOLD A POINT, OR USE MOVE POINT');
          gesture.current = { kind: 'pan', p0: p, t0: { x: tx, y: ty }, moved: true };
          return;
        }
        if (!g.moved && Math.hypot(p.x - g.p0.x, p.y - g.p0.y) < DRAG_SLOP) return;
        g.moved = true;
        const dx = (p.x - g.p0.x) * unitsPerPx * g.factor;
        const dy = (p.y - g.p0.y) * unitsPerPx * g.factor;
        if (g.part === 'body') {
          setDoc(drag(g.before, g.sel, dx, dy));
        } else {
          const handle = handlesOf(g.before, g.sel)[g.part];
          if (!handle) return;
          setDoc(dragHandle(g.before, g.sel, g.part, { x: handle.x + dx, y: handle.y + dy }));
        }
        return;
      }
      default:
        return;
    }
  }

  function onRelease(e: GestureResponderEvent) {
    const g = gesture.current;
    gesture.current = { kind: 'none' };
    clearHold();
    setPending(null);
    if (g.kind === 'draw') {
      const line = lineFrom(g.start, toUnits(canvasPoint(e.nativeEvent)));
      if (!line) return;
      if (!line.kind && Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < MIN_LINE_LENGTH) return;
      commit({ ...doc, lines: [...lines, { ...line, id: makeId() }] });
    } else if (g.kind === 'brush') {
      const last = g.points[g.points.length - 1];
      commit({
        ...doc,
        lines: [
          ...lines,
          {
            ...styled({ x1: g.points[0].x, y1: g.points[0].y, x2: last.x, y2: last.y }),
            id: makeId(),
            kind: 'stroke',
            style: 'solid',
            points: g.points,
          },
        ],
      });
    } else if (g.kind === 'drag' && g.moved) {
      remember(g.before);
    } else if (g.kind === 'pan' && !g.moved) {
      setSel(null);
      setMoveOn(false);
    }
  }

  function onTerminate() {
    const g = gesture.current;
    if (g.kind === 'drag' && g.moved) remember(g.before);
    gesture.current = { kind: 'none' };
    clearHold();
    setPending(null);
  }

  // ---------- toolbar actions ----------
  function chooseMode(next: string) {
    setMode(next);
    setMoveOn(false);
    if (next === 'edit') flash('TAP A POINT OR A LINE TO SELECT IT');
    else setSel(null);
    if (next === 'arc' && (!fe1 || !fe2)) flash('ADD THE FISHEYE POINTS FIRST: ADJUST → + FISHEYE');
  }

  function select(next: Selection) {
    setSel(next);
    setMoveOn(false);
  }

  function selectStar(id: string) {
    select({ kind: 'star', id });
    const star = overlay.stars.find((st) => st.id === id);
    if (star && !onScreen(star)) fitTo([star]);
  }

  function pushStar(direction: 1 | -1, tick: number) {
    if (selected?.kind !== 'star') return;
    const id = selected.id;
    const factor = 1 + direction * 0.004 * Math.min(10, 1 + tick / 4);
    setDoc((d) => pushStarDoc(d, id, factor));
  }

  const nextLabel = STAR_LABELS.find((l) => !overlay.stars.some((st) => st.label === l)) ?? null;
  const hasFisheye = FISHEYE_LABELS.every((l) => overlay.stars.some((st) => st.label === l));

  function makeStar(label: StarLabel, pos: Point): SavedStar {
    return { id: makeId(), label, color: STAR_COLORS[label], x: pos.x, y: pos.y, visible: true };
  }

  /** Adds the next vanishing point where it is easy to find; the user then moves it. */
  function addStar() {
    if (!nextLabel) return;
    const h = horizonHandles(overlay);
    let pos: Point;
    if (nextLabel === 'VP3') {
      pos = { x: OVERLAY_WIDTH / 2, y: overlay.height * 0.85 };
    } else {
      const f = nextLabel === 'VP1' ? 0.2 : 0.8;
      pos = h
        ? { x: h.x1 + (h.x2 - h.x1) * f, y: h.y1 + (h.y2 - h.y1) * f }
        : { x: OVERLAY_WIDTH * f, y: overlay.height / 2 };
    }
    const star = makeStar(nextLabel, pos);
    commit(
      nextLabel === 'VP3' ? { ...doc, overlay: { ...overlay, stars: [...overlay.stars, star] } } : addStarTo(doc, star),
    );
    select({ kind: 'star', id: star.id });
    if (!onScreen(pos)) setZoom({ s: 1, tx: 0, ty: 0 });
  }

  /** Fisheye: two points (left and right); every arc passes through both. */
  function addFisheye() {
    const h = horizonHandles(overlay);
    const at = (f: number): Point =>
      h
        ? { x: h.x1 + (h.x2 - h.x1) * f, y: h.y1 + (h.y2 - h.y1) * f }
        : { x: OVERLAY_WIDTH * f, y: overlay.height / 2 };
    const a = makeStar('FE1', at(0.05));
    const c = makeStar('FE2', at(0.95));
    commit(addStarTo(addStarTo(doc, a), c));
    setMode('arc');
    setSel(null);
    setMoveOn(false);
    flash('FISHEYE READY: TAP THE PHOTO TO DRAW ARCS');
  }

  function addHorizon() {
    commit({ ...doc, overlay: { ...overlay, horizon: defaultHorizon(overlay.height) } });
    select({ kind: 'horizon' });
  }

  function deleteSelected() {
    if (!selected) return;
    if (selected.kind === 'star') {
      const n = attachedCount(doc, selected.id);
      const label = overlay.stars.find((st) => st.id === selected.id)?.label ?? 'POINT';
      if (n > 0) flash(`${label} AND ITS ${n} LINE${n === 1 ? '' : 'S'} DELETED`);
    }
    commit(remove(doc, selected));
    setSel(null);
    setMoveOn(false);
  }

  function applyStyle(patch: Partial<Pick<DrawnLine, 'width' | 'style' | 'color'>>) {
    if (patch.width !== undefined) updateSettings({ lineWidth: patch.width });
    if (patch.style !== undefined) updateSettings({ lineStyle: patch.style });
    if (patch.color !== undefined) updateSettings({ lineColor: patch.color });
    if (editing && selectedLine) {
      commit({ ...doc, lines: lines.map((l) => (l.id === selectedLine.id ? { ...l, ...patch } : l)) });
    }
  }

  function undo() {
    if (history.length === 0) return;
    setDoc(history[history.length - 1]);
    setHistory((h) => h.slice(0, -1));
    setDirty(true);
  }

  function clearAll() {
    if (lines.length === 0) return;
    Alert.alert('Clear all lines?', 'This removes every line you drew on this photo.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear all', style: 'destructive', onPress: () => commit({ ...doc, lines: [] }) },
    ]);
  }

  async function save() {
    if (saving || !base) return;
    setSaving(true);
    try {
      const finalOverlay = finalizeOverlay(overlay, base.overlay);
      if (photo) {
        await updatePhotoEdits(photo.id, lines, finalOverlay);
      } else if (editingDraft) {
        const id = await saveDraft({ ...editingDraft, overlay: finalOverlay }, lines);
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
      photo ? 'Your latest changes have not been saved.' : 'This photo has not been saved to the gallery.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: goToCamera },
      ],
    );
  }

  function onArea(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setArea({ w: width, h: height });
  }

  const canSave = !saving && (dirty || (!photo && !!editingDraft));
  const selectedHandles = editing && selected ? handlesOf(doc, selected) : [];
  const selectedAnchor = selected ? anchorOf(doc, selected) : null;
  const selectedStar = selected?.kind === 'star' ? overlay.stars.find((st) => st.id === selected.id) : undefined;
  const selectedStraight =
    editing && selected && (selected.kind === 'horizon' || selected.kind === 'guide')
      ? selected.kind === 'horizon'
        ? horizonHandles(overlay)
        : overlay.guides[selected.index]
      : null;
  const showStyleRows = !editing || !!selectedLine;
  const lineWidthNow = selectedLine && editing ? selectedLine.width : settings.lineWidth;
  const lineStyleNow = selectedLine && editing ? selectedLine.style : settings.lineStyle;
  const lineColorNow = selectedLine && editing ? selectedLine.color : settings.lineColor;

  const moveLabel = !selected
    ? 'MOVE'
    : selected.kind === 'star'
      ? 'MOVE POINT'
      : selected.kind === 'horizon'
        ? 'MOVE HORIZON'
        : selectedAnchor
          ? 'TURN LINE'
          : selectedLine?.kind === 'arc'
            ? 'BEND ARC'
            : selectedLine?.kind === 'stroke'
              ? 'MOVE NOTE'
              : 'MOVE LINE';
  const moveHint = !selected
    ? 'TAP A POINT OR A LINE ON THE PHOTO TO SELECT IT'
    : moveOn
      ? selected.kind === 'star'
        ? 'DRAG ANYWHERE ON THE PHOTO · THE POINT MOVES SLOWLY, FOR PRECISION'
        : 'DRAG ANYWHERE ON THE PHOTO TO MOVE IT'
      : selected.kind === 'star'
        ? `${selectedStar?.label ?? ''} SELECTED · TAP ${moveLabel} OR HOLD THE POINT TO DRAG`
        : selectedAnchor
          ? `TURNS AROUND ${selectedAnchor.label} · DRAG ITS END`
          : `DRAG IT, OR TAP ${moveLabel}`;

  const drawTools: { key: Tool; label: string; icon: IconName; a11y: string; show: boolean }[] = [
    {
      key: 'vertical',
      label: vp3 ? 'Vertical → VP3' : 'Vertical',
      icon: 'vertical',
      a11y: 'Vertical lines',
      show: true,
    },
    { key: 'arc', label: 'Arc', icon: 'arc', a11y: 'Fisheye arcs through FE1 and FE2', show: hasFisheye },
    { key: 'free', label: 'Free', icon: 'right', a11y: 'Free straight lines', show: true },
    { key: 'brush', label: 'Brush', icon: 'brush', a11y: 'Brush for notes', show: true },
  ];

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="EDITOR"
        onCamera={leave}
        right={<LinkButton label="Learn" onPress={() => router.push('/info')} accessibilityLabel="How perspective works" />}
      />

      <View style={styles.canvasArea} onLayout={onArea}>
        {dispW > 0 && (
          <>
            <Image
              source={{ uri: base.uri }}
              style={{
                position: 'absolute',
                left: ox + tx,
                top: oy + ty,
                width: dispW * s,
                height: dispH * s,
              }}
              contentFit="cover"
            />
            <OverlayLayer
              overlay={overlay}
              lines={lines}
              pendingLine={pending}
              activeStarId={editing ? (selectedStar?.id ?? null) : fromStar?.id}
              highlightLineId={editing ? selectedLine?.id : null}
              viewBox={viewBox}
              markerScale={1 / s}
              lineScale={Math.max(1, 1 / s)}
              showAllStars
              extensions={extensionsFor(doc)}
            />
            {(selectedStraight || selectedHandles.length > 0) && (
              <Svg style={StyleSheet.absoluteFill} viewBox={viewBox} preserveAspectRatio="none" pointerEvents="none">
                {selectedStraight && (
                  <Line
                    x1={selectedStraight.x1}
                    y1={selectedStraight.y1}
                    x2={selectedStraight.x2}
                    y2={selectedStraight.y2}
                    stroke={BLUE}
                    strokeOpacity={0.35}
                    strokeWidth={14 * unitsPerPx}
                    strokeLinecap="round"
                  />
                )}
                {selectedHandles.map((p, i) => (
                  <Circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={11 * unitsPerPx}
                    fill={WHITE}
                    stroke={BLUE}
                    strokeWidth={3 * unitsPerPx}
                  />
                ))}
              </Svg>
            )}
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
            <View style={styles.zoomBar}>
              <Pressable
                style={styles.zoomBtn}
                onPress={() => zoomAround({ x: W / 2, y: H / 2 }, s * 1.5)}
                accessibilityRole="button"
                accessibilityLabel="Zoom in"
              >
                <Text style={styles.zoomText}>+</Text>
              </Pressable>
              <Pressable
                style={styles.zoomBtn}
                onPress={() => zoomAround({ x: W / 2, y: H / 2 }, s / 1.5)}
                accessibilityRole="button"
                accessibilityLabel="Zoom out"
              >
                <Text style={styles.zoomText}>−</Text>
              </Pressable>
              <Pressable
                style={styles.zoomBtn}
                onPress={() => setZoom({ s: 1, tx: 0, ty: 0 })}
                accessibilityRole="button"
                accessibilityLabel="Fit photo"
              >
                <Text style={styles.zoomSmall}>FIT</Text>
              </Pressable>
              <Pressable
                style={styles.zoomBtn}
                onPress={() => fitTo(overlay.stars)}
                accessibilityRole="button"
                accessibilityLabel="Show all vanishing points"
              >
                <Text style={styles.zoomSmall}>ALL</Text>
              </Pressable>
              <Text style={styles.zoomLabel}>{s >= 1 ? s.toFixed(1) : s.toFixed(2)}×</Text>
            </View>
          </>
        )}
        {toast && (
          <View style={styles.toast} pointerEvents="none">
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        )}
      </View>

      <View style={[styles.tools, { paddingBottom: insets.bottom + 8 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          <Text style={styles.rowLabel}>DRAW</Text>
          {overlay.stars
            .filter((st) => !st.label.startsWith('FE'))
            .map((star) => {
              const active = mode === star.id;
              return (
                <Pressable
                  key={star.id}
                  onPress={() => chooseMode(star.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Draw lines from ${star.label}`}
                  style={[
                    styles.pointChip,
                    { backgroundColor: star.color, borderColor: active ? BLUE : star.color },
                    active && styles.pointChipSelected,
                  ]}
                >
                  <Text style={[styles.pointChipText, { color: textOn(star.color) }]}>{star.label}</Text>
                </Pressable>
              );
            })}
          {drawTools
            .filter((t) => t.show)
            .map((t) => (
              <ToolChip
                key={t.key}
                label={t.label}
                icon={t.icon}
                on={mode === t.key}
                onPress={() => chooseMode(t.key)}
                accessibilityLabel={t.a11y}
              />
            ))}
          <View style={styles.divider} />
          <Pressable
            onPress={() => chooseMode('edit')}
            style={[styles.adjustChip, editing && styles.adjustChipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: editing }}
            accessibilityLabel="Select and adjust points and lines"
          >
            <Text style={[styles.adjustText, editing && styles.adjustTextOn]}>ADJUST</Text>
          </Pressable>
        </ScrollView>

        {editing && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Text style={styles.rowLabel}>SELECT</Text>
              {overlay.stars.map((star) => {
                const on = selected?.kind === 'star' && selected.id === star.id;
                return (
                  <Pressable
                    key={star.id}
                    onPress={() => selectStar(star.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Select ${star.label}`}
                    style={[
                      styles.pointChip,
                      { backgroundColor: star.color, borderColor: on ? BLUE : star.color },
                      on && styles.pointChipSelected,
                    ]}
                  >
                    <Text style={[styles.pointChipText, { color: textOn(star.color) }]}>{star.label}</Text>
                  </Pressable>
                );
              })}
              {overlay.horizon ? (
                <Pressable
                  onPress={() => select({ kind: 'horizon' })}
                  style={[styles.chip, selected?.kind === 'horizon' && styles.chipSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: selected?.kind === 'horizon' }}
                  accessibilityLabel="Select the horizon"
                >
                  <View style={styles.horizonSample} />
                  <Text style={[styles.chipText, selected?.kind === 'horizon' && styles.chipTextSelected]}>
                    Horizon
                  </Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={addHorizon}
                  style={[styles.chip, styles.addChip]}
                  accessibilityRole="button"
                  accessibilityLabel="Add a horizon line"
                >
                  <Text style={[styles.chipText, styles.addText]}>+ Horizon</Text>
                </Pressable>
              )}
              {nextLabel && (
                <Pressable
                  onPress={addStar}
                  style={[styles.chip, styles.addChip]}
                  accessibilityRole="button"
                  accessibilityLabel={`Add vanishing point ${nextLabel}`}
                >
                  <Text style={[styles.chipText, styles.addText]}>+ {nextLabel}</Text>
                </Pressable>
              )}
              {!hasFisheye && (
                <Pressable
                  onPress={addFisheye}
                  style={[styles.chip, styles.addChip]}
                  accessibilityRole="button"
                  accessibilityLabel="Add fisheye points FE1 and FE2"
                >
                  <Text style={[styles.chipText, styles.addText]}>+ Fisheye</Text>
                </Pressable>
              )}
            </ScrollView>

            <View style={styles.moveRow}>
              <Pressable
                disabled={!selected}
                onPress={() => setMoveOn((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ selected: moveOn }}
                accessibilityLabel={moveLabel}
                style={({ pressed }) => [
                  styles.moveBtn,
                  moveOn && styles.moveBtnOn,
                  { opacity: !selected ? 0.35 : pressed ? 0.7 : 1 },
                ]}
              >
                <Text style={[styles.moveBtnText, moveOn && styles.moveBtnTextOn]}>
                  {moveOn ? `${moveLabel} · ON` : moveLabel}
                </Text>
              </Pressable>
              {selected?.kind === 'star' && (
                <>
                  <RepeatButton
                    label="Closer"
                    accessibilityLabel="Move the point closer to the photo"
                    onStart={() => remember(doc)}
                    onStep={(t) => pushStar(-1, t)}
                  />
                  <RepeatButton
                    label="Farther"
                    accessibilityLabel="Move the point farther from the photo"
                    onStart={() => remember(doc)}
                    onStep={(t) => pushStar(1, t)}
                  />
                </>
              )}
              <LinkButton
                label="Delete"
                onPress={deleteSelected}
                disabled={!selected}
                color={DANGER}
                style={styles.deleteBtn}
              />
            </View>
            <Text style={styles.moveHint}>{moveHint}</Text>
          </>
        )}

        {showStyleRows && (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Text style={styles.rowLabel}>WIDTH</Text>
              {LINE_WIDTHS.map((opt) => {
                const on = lineWidthNow === opt.value;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => applyStyle({ width: opt.value })}
                    style={[styles.chip, on && styles.chipSelected]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Line width ${opt.label}`}
                  >
                    <View style={[styles.widthSample, { height: Math.max(1, opt.value / 3) }]} />
                    <Text style={[styles.chipText, on && styles.chipTextSelected]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {tool !== 'brush' && selectedLine?.kind !== 'stroke' && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                <Text style={styles.rowLabel}>STYLE</Text>
                {LINE_STYLES.map((style) => {
                  const on = lineStyleNow === style;
                  return (
                    <Pressable
                      key={style}
                      onPress={() => applyStyle({ style })}
                      style={[styles.chip, on && styles.chipSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Line style ${style}`}
                    >
                      <Svg width={28} height={8}>
                        <Line
                          x1={3}
                          y1={4}
                          x2={25}
                          y2={4}
                          stroke={on ? BLUE : INK}
                          strokeWidth={2.5}
                          strokeDasharray={dashFor({ style, width: 2.5 })}
                          strokeLinecap={style === 'dashed' ? 'butt' : 'round'}
                        />
                      </Svg>
                      <Text style={[styles.chipText, on && styles.chipTextSelected]}>{style}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
              <Text style={styles.rowLabel}>COLOR</Text>
              {LINE_PALETTE.map((color) => {
                const on = lineColorNow === color;
                return (
                  <Pressable
                    key={color}
                    onPress={() => applyStyle({ color })}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`Line color ${color}`}
                    style={[styles.swatchRing, on && { borderColor: BLUE }]}
                  >
                    <View style={[styles.swatch, { backgroundColor: color }]} />
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        <View style={styles.actions}>
          <LinkButton label="Undo" onPress={undo} disabled={history.length === 0} />
          <LinkButton label="Clear lines" onPress={clearAll} disabled={lines.length === 0} color={DANGER} />
          <Text style={styles.count}>
            {lines.length} LINE{lines.length === 1 ? '' : 'S'}
          </Text>
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
  canvasArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E9EBEF',
    overflow: 'hidden',
  },
  zoomBar: { position: 'absolute', top: 10, right: 10, alignItems: 'center', gap: 6 },
  zoomBtn: {
    width: 42,
    height: 34,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: HAIRLINE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: { fontFamily: Fonts.mono, fontSize: 20, color: BLUE, fontWeight: '700' },
  zoomSmall: { fontFamily: Fonts.mono, fontSize: 11, color: BLUE, fontWeight: '700', letterSpacing: 1 },
  zoomLabel: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: INK,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  toast: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 64,
    alignItems: 'flex-start',
  },
  toastText: {
    fontFamily: Fonts.mono,
    color: WHITE,
    fontSize: 11,
    letterSpacing: 1,
    backgroundColor: INK,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
  tools: {
    backgroundColor: WHITE,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: HAIRLINE,
    paddingTop: 6,
  },
  row: { alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 5 },
  rowLabel: { fontFamily: Fonts.mono, fontSize: 10, color: MUTED, width: 46, letterSpacing: 1 },
  divider: { width: StyleSheet.hairlineWidth, height: 26, backgroundColor: HAIRLINE, marginHorizontal: 2 },
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
  addChip: { borderColor: BLUE, borderStyle: 'dashed' },
  addText: { color: BLUE, fontWeight: '700' },
  adjustChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: BLUE,
  },
  adjustChipOn: { backgroundColor: BLUE },
  adjustText: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700', color: BLUE, letterSpacing: 1 },
  adjustTextOn: { color: WHITE },
  pointChip: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointChipSelected: { borderWidth: 3 },
  pointChipText: { fontFamily: Fonts.mono, fontSize: 10, fontWeight: '700' },
  horizonSample: { width: 18, height: 3, backgroundColor: HORIZON_COLOR, borderRadius: 2 },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  moveBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnOn: { backgroundColor: BLUE },
  moveBtnText: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700', color: BLUE, letterSpacing: 1 },
  moveBtnTextOn: { color: WHITE },
  outlineBtn: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: { fontFamily: Fonts.sans, fontSize: 13, color: BLUE, fontWeight: '700' },
  deleteBtn: { marginLeft: 'auto' },
  moveHint: {
    fontFamily: Fonts.mono,
    fontSize: 10,
    color: MUTED,
    letterSpacing: 0.5,
    paddingHorizontal: 14,
    paddingBottom: 2,
  },
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
