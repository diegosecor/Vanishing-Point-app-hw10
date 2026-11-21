import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';

import { Fonts, HORIZON_COLOR, STAR_COLORS } from '@/constants/style';
import { arcPath } from '@/lib/edit';
import type { Point } from '@/lib/types';

export type DiagramKind = 'one' | 'two' | 'three' | 'fisheye';

/** Diagram coordinate system. */
const W = 320;
const H = 240;
const CX = W / 2;
const FACE_LEFT = '#FFE2CC';
const FACE_RIGHT = '#CCE0F5';
const FACE_TOP = '#FFF3C4';
const EDGE = '#0B0B0F';
const GUIDE_OPACITY = 0.45;

type Handles = Record<string, Point>;

function initial(kind: DiagramKind): Handles {
  switch (kind) {
    case 'one':
      return { v1: { x: CX, y: 105 } };
    case 'two':
      return { v1: { x: 14, y: 110 }, v2: { x: 306, y: 110 } };
    case 'three':
      return { v1: { x: 14, y: 40 }, v2: { x: 306, y: 40 }, v3: { x: CX, y: 430 } };
    case 'fisheye':
      return { v1: { x: 25, y: 120 }, v2: { x: 295, y: 120 } };
  }
}

/** Gentle motion so the diagram shows how the drawing reacts to the points. */
function animated(kind: DiagramKind, t: number): Handles {
  const base = initial(kind);
  const s = Math.sin(t);
  const c = Math.sin(t * 0.7);
  switch (kind) {
    case 'one':
      return { v1: { x: CX + 70 * s, y: 105 + 30 * c } };
    case 'two': {
      const hy = 110 + 70 * c;
      return { v1: { x: 14 + 10 * s, y: hy }, v2: { x: 306 + 10 * s, y: hy } };
    }
    case 'three':
      return { ...base, v3: { x: CX + 40 * s, y: 420 + 80 * c } };
    case 'fisheye':
      return { v1: { x: 25 + 25 * s, y: 120 }, v2: { x: 295 - 25 * s, y: 120 } };
  }
}

/** Point on the line a→b at the given x (or a when the line is vertical). */
function atX(a: Point, b: Point, x: number): Point {
  if (Math.abs(b.x - a.x) < 1e-6) return { x, y: a.y };
  const t = (x - a.x) / (b.x - a.x);
  return { x, y: a.y + (b.y - a.y) * t };
}

function atY(a: Point, b: Point, y: number): Point {
  if (Math.abs(b.y - a.y) < 1e-6) return { x: a.x, y };
  const t = (y - a.y) / (b.y - a.y);
  return { x: a.x + (b.x - a.x) * t, y };
}

/** Intersection of lines a1→a2 and b1→b2. */
function meet(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const p = a1.x * a2.y - a1.y * a2.x;
  const q = b1.x * b2.y - b1.y * b2.x;
  return { x: (p * (b1.x - b2.x) - (a1.x - a2.x) * q) / d, y: (p * (b1.y - b2.y) - (a1.y - a2.y) * q) / d };
}

const pts = (...p: Point[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

function Guide({ from, to, color }: { from: Point; to: Point; color: string }) {
  return (
    <Line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={color}
      strokeWidth={1}
      strokeOpacity={GUIDE_OPACITY}
      strokeDasharray="4 3"
    />
  );
}

function Edge({ a, b }: { a: Point; b: Point }) {
  return <Line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE} strokeWidth={2} strokeLinecap="round" />;
}

function Horizon({ y }: { y: number }) {
  return (
    <G>
      <Line x1={-400} y1={y} x2={W + 400} y2={y} stroke={HORIZON_COLOR} strokeWidth={2} />
      <SvgText x={6} y={y - 5} fill={HORIZON_COLOR} fontSize={9} fontFamily={Fonts.mono} fontWeight="bold">
        EYE LEVEL
      </SvgText>
    </G>
  );
}

function OnePoint({ h }: { h: Handles }) {
  const v = h.v1;
  const color = STAR_COLORS.VP1;
  // Back wall of a room, around the vanishing point.
  const bw = { l: v.x - 55, r: v.x + 55, t: v.y - 40, b: v.y + 45 };
  const corners = [
    { x: bw.l, y: bw.t },
    { x: bw.r, y: bw.t },
    { x: bw.r, y: bw.b },
    { x: bw.l, y: bw.b },
  ];
  // Extend from the point through each back corner to far outside the frame.
  const out = corners.map((c) => ({ x: v.x + (c.x - v.x) * 8, y: v.y + (c.y - v.y) * 8 }));
  const floor = [-160, -100, -40, 40, 100, 160].map((dx) => ({ x: v.x + dx * 6, y: v.y + 45 * 6 }));
  return (
    <G>
      {floor.map((f, i) => (
        <Guide key={i} from={v} to={f} color={color} />
      ))}
      <Polygon points={pts(corners[3], corners[2], out[2], out[3])} fill={FACE_TOP} />
      <Polygon points={pts(corners[0], corners[3], out[3], out[0])} fill={FACE_LEFT} />
      <Polygon points={pts(corners[1], corners[2], out[2], out[1])} fill={FACE_RIGHT} />
      <Rect x={bw.l} y={bw.t} width={bw.r - bw.l} height={bw.b - bw.t} fill="#FFFFFF" stroke={EDGE} strokeWidth={2} />
      {corners.map((c, i) => (
        <Edge key={i} a={c} b={out[i]} />
      ))}
      {corners.map((c, i) => (
        <Guide key={`g${i}`} from={v} to={c} color={color} />
      ))}
      <Horizon y={v.y} />
    </G>
  );
}

function Box({ h, three }: { h: Handles; three: boolean }) {
  const { v1, v2 } = h;
  const v3 = three ? h.v3 : null;
  const T = { x: CX, y: 70 };
  // Without VP3 the verticals stay parallel; with it they converge toward it.
  const B = v3 ? atY(T, v3, 200) : { x: CX, y: 200 };
  const down = (p: Point, bottomRail: [Point, Point]) =>
    v3 ? (meet(p, v3, bottomRail[0], bottomRail[1]) ?? p) : atX(bottomRail[0], bottomRail[1], p.x);
  const LT = atX(T, v1, CX - 55);
  const RT = atX(T, v2, CX + 60);
  const LB = down(LT, [B, v1]);
  const RB = down(RT, [B, v2]);
  const hy = v1.y;
  const showTop = hy < Math.min(LT.y, RT.y, T.y);
  const showBottom = hy > Math.max(LB.y, RB.y, B.y);
  const back = showTop ? meet(LT, v2, RT, v1) : showBottom ? meet(LB, v2, RB, v1) : null;
  return (
    <G>
      <Horizon y={hy} />
      {[T, LT, B, LB].map((p, i) => (
        <Guide key={`a${i}`} from={p} to={v1} color={STAR_COLORS.VP1} />
      ))}
      {[T, RT, B, RB].map((p, i) => (
        <Guide key={`b${i}`} from={p} to={v2} color={STAR_COLORS.VP2} />
      ))}
      {v3 && [T, LT, RT].map((p, i) => <Guide key={`c${i}`} from={p} to={v3} color={STAR_COLORS.VP3} />)}
      <Polygon points={pts(T, LT, LB, B)} fill={FACE_LEFT} stroke={EDGE} strokeWidth={2} strokeLinejoin="round" />
      <Polygon points={pts(T, RT, RB, B)} fill={FACE_RIGHT} stroke={EDGE} strokeWidth={2} strokeLinejoin="round" />
      {back && showTop && (
        <Polygon points={pts(T, LT, back, RT)} fill={FACE_TOP} stroke={EDGE} strokeWidth={2} strokeLinejoin="round" />
      )}
      {back && showBottom && (
        <Polygon points={pts(B, LB, back, RB)} fill={FACE_TOP} stroke={EDGE} strokeWidth={2} strokeLinejoin="round" />
      )}
    </G>
  );
}

function Fisheye({ h }: { h: Handles }) {
  const { v1, v2 } = h;
  const mid = (v1.x + v2.x) / 2;
  const top = { x: mid, y: -230 };
  const bottom = { x: mid, y: H + 230 };
  return (
    <G>
      {[-110, -70, -35, 35, 70, 110].map((dy) => (
        <Path
          key={`h${dy}`}
          d={arcPath(v1, v2, { x: mid, y: v1.y + dy })}
          stroke={STAR_COLORS.FE1}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {[-120, -75, -35, 35, 75, 120].map((dx) => (
        <Path
          key={`v${dx}`}
          d={arcPath(top, bottom, { x: mid + dx, y: v1.y })}
          stroke="#0057B8"
          strokeOpacity={0.55}
          strokeWidth={1.5}
          fill="none"
        />
      ))}
      <Line x1={mid} y1={-20} x2={mid} y2={H + 20} stroke="#0057B8" strokeOpacity={0.55} strokeWidth={1.5} />
      <Horizon y={v1.y} />
    </G>
  );
}

const LABELS: Record<string, string> = { v1: 'VP1', v2: 'VP2', v3: 'VP3' };

/**
 * Small interactive perspective drawing. It moves by itself until touched; then the
 * colored points can be dragged and the drawing follows.
 */
export function PerspectiveDiagram({ kind }: { kind: DiagramKind }) {
  const [handles, setHandles] = useState<Handles>(() => initial(kind));
  const [auto, setAuto] = useState(true);
  const [width, setWidth] = useState(0);
  const dragging = useRef<string | null>(null);

  useEffect(() => {
    if (!auto) return;
    let frame = 0;
    const start = Date.now();
    const tick = () => {
      setHandles(animated(kind, (Date.now() - start) / 1400));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [auto, kind]);

  const scale = width > 0 ? W / width : 1;
  // The 3-point drawing needs room for VP3 below the box.
  const viewH = kind === 'three' ? 460 : H;
  const height = width > 0 ? (width * viewH) / W : 0;

  function toDiagram(e: GestureResponderEvent): Point {
    return { x: e.nativeEvent.locationX * scale, y: e.nativeEvent.locationY * scale };
  }

  function onGrant(e: GestureResponderEvent) {
    setAuto(false);
    const p = toDiagram(e);
    let best: string | null = null;
    let bestD = 40;
    for (const [key, h] of Object.entries(handles)) {
      const d = Math.hypot(h.x - p.x, h.y - p.y);
      if (d < bestD) {
        best = key;
        bestD = d;
      }
    }
    dragging.current = best;
  }

  function onMove(e: GestureResponderEvent) {
    const key = dragging.current;
    if (!key) return;
    const p = toDiagram(e);
    const x = Math.max(-40, Math.min(W + 40, p.x));
    const y = Math.max(10, Math.min(viewH - 10, p.y));
    setHandles((prev) => {
      if (kind === 'fisheye' || ((kind === 'two' || kind === 'three') && key !== 'v3')) {
        // Points on the horizon share one height: moving one moves eye level for all.
        const next: Handles = {};
        for (const [k, h] of Object.entries(prev)) next[k] = k === 'v3' ? h : { x: k === key ? x : h.x, y };
        return next;
      }
      return { ...prev, [key]: { x, y } };
    });
  }

  function onLayout(e: LayoutChangeEvent) {
    setWidth(e.nativeEvent.layout.width);
  }

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {width > 0 && (
        <View
          style={{ width, height }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={onGrant}
          onResponderMove={onMove}
          onResponderRelease={() => (dragging.current = null)}
          onResponderTerminationRequest={() => false}
        >
          <Svg width={width} height={height} viewBox={`0 0 ${W} ${viewH}`} pointerEvents="none">
            <Rect x={0} y={0} width={W} height={viewH} fill="#F7F8FA" />
            {kind === 'one' && <OnePoint h={handles} />}
            {kind === 'two' && <Box h={handles} three={false} />}
            {kind === 'three' && <Box h={handles} three />}
            {kind === 'fisheye' && <Fisheye h={handles} />}
            {Object.entries(handles).map(([key, p]) => {
              const color = kind === 'fisheye' ? STAR_COLORS.FE1 : STAR_COLORS[LABELS[key] as 'VP1' | 'VP2' | 'VP3'];
              const label = kind === 'fisheye' ? (key === 'v1' ? 'FE1' : 'FE2') : LABELS[key];
              return (
                <G key={key}>
                  <Circle cx={p.x} cy={p.y} r={9} fill={color} stroke="#FFFFFF" strokeWidth={2.5} />
                  <SvgText
                    x={p.x + 12}
                    y={p.y - 9}
                    fill={EDGE}
                    fontSize={10}
                    fontWeight="bold"
                    fontFamily={Fonts.mono}
                  >
                    {label}
                  </SvgText>
                </G>
              );
            })}
          </Svg>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', borderRadius: 8, overflow: 'hidden' },
});
