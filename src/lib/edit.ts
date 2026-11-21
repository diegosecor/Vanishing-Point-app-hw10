import { distance, distanceToSegment } from './geometry';
import { clipLine, clipRay } from './projection';
import { OVERLAY_WIDTH, type DrawnLine, type Guide, type Overlay, type Point, type SavedStar } from './types';

/**
 * Editing rules, so points and lines stay organized:
 * - Vanishing points move freely (they start on the horizon when added).
 * - A line or guide drawn from a point stays attached: it only turns around its point
 *   and follows it when the point moves. Deleting a point deletes its lines too.
 * - Fisheye arcs pass through FE1 and FE2 and follow them; dragging an arc bends it.
 * - Free lines and brush strokes move freely.
 */

/** Everything the editor can change, kept together so one undo step covers it all. */
export type EditDoc = { lines: DrawnLine[]; overlay: Overlay };

export type Selection =
  | { kind: 'line'; id: string }
  | { kind: 'guide'; index: number }
  | { kind: 'horizon' }
  | { kind: 'star'; id: string };

export type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Stars further than this (overlay units) are effectively at infinity and ignored for "fit". */
export const FAR_LIMIT = 30000;
const HORIZON_EXTENT = 40000;

function rectOf(o: Overlay) {
  return { w: OVERLAY_WIDTH, h: o.height };
}

function unit(dx: number, dy: number): Point | null {
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? null : { x: dx / len, y: dy / len };
}

/** Distance from p to the infinite line through a segment. */
function distanceToLine(p: Point, s: Seg): number {
  const d = unit(s.x2 - s.x1, s.y2 - s.y1);
  if (!d) return distance(p, { x: s.x1, y: s.y1 });
  return Math.abs((p.x - s.x1) * d.y - (p.y - s.y1) * d.x);
}

function insidePhoto(o: Overlay, p: Point): boolean {
  return p.x >= 0 && p.x <= OVERLAY_WIDTH && p.y >= 0 && p.y <= o.height;
}

// ---------- horizon ----------

/** Long horizon through two points. */
export function extendHorizon(a: Point, b: Point): Seg | null {
  const d = unit(b.x - a.x, b.y - a.y);
  if (!d) return null;
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    x1: m.x - d.x * HORIZON_EXTENT,
    y1: m.y - d.y * HORIZON_EXTENT,
    x2: m.x + d.x * HORIZON_EXTENT,
    y2: m.y + d.y * HORIZON_EXTENT,
  };
}

/** A level horizon through the middle of the photo. */
export function defaultHorizon(height: number): Seg {
  return extendHorizon({ x: 0, y: height / 2 }, { x: OVERLAY_WIDTH, y: height / 2 })!;
}

/** Closest point on the horizon. */
export function projectOnHorizon(h: Seg, p: Point): Point {
  const d = unit(h.x2 - h.x1, h.y2 - h.y1);
  if (!d) return p;
  const t = (p.x - h.x1) * d.x + (p.y - h.y1) * d.y;
  return { x: h.x1 + d.x * t, y: h.y1 + d.y * t };
}

/** The visible part of the horizon, used for its two drag handles. */
export function horizonHandles(o: Overlay): Seg | null {
  const h = o.horizon;
  if (!h) return null;
  const d = unit(h.x2 - h.x1, h.y2 - h.y1);
  if (!d) return null;
  const inside = clipLine({ x: h.x1, y: h.y1 }, d, rectOf(o));
  if (inside && distance({ x: inside.x1, y: inside.y1 }, { x: inside.x2, y: inside.y2 }) > 40) return inside;
  // Horizon is outside the photo: put the handles near the photo, around the closest point.
  const foot = projectOnHorizon(h, { x: OVERLAY_WIDTH / 2, y: o.height / 2 });
  return { x1: foot.x - d.x * 250, y1: foot.y - d.y * 250, x2: foot.x + d.x * 250, y2: foot.y + d.y * 250 };
}

// ---------- arcs (fisheye) and strokes (brush) ----------

/** Circle through three points, or null when they are (almost) on a straight line. */
function circleThrough(a: Point, b: Point, c: Point): { cx: number; cy: number; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);
  return r > 1e6 ? null : { cx, cy, r };
}

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

/** Arc from a to b passing through via: SVG path data. */
export function arcPath(a: Point, b: Point, via: Point): string {
  const c = circleThrough(a, b, via);
  if (!c) return `M${a.x} ${a.y} L${b.x} ${b.y}`;
  const ta = Math.atan2(a.y - c.cy, a.x - c.cx);
  const tb = Math.atan2(b.y - c.cy, b.x - c.cx);
  const tv = Math.atan2(via.y - c.cy, via.x - c.cx);
  const ab = wrap(tb - ta);
  const av = wrap(tv - ta);
  // Sweep 1 = increasing angle (clockwise on screen). Pick the way that passes through via.
  const sweep = av < ab ? 1 : 0;
  const span = sweep ? ab : TAU - ab;
  const large = span > Math.PI ? 1 : 0;
  return `M${a.x} ${a.y} A${c.r} ${c.r} 0 ${large} ${sweep} ${b.x} ${b.y}`;
}

/** Points along the arc, for hit testing. */
export function arcPoints(a: Point, b: Point, via: Point, n = 48): Point[] {
  const c = circleThrough(a, b, via);
  if (!c) return [a, b];
  const ta = Math.atan2(a.y - c.cy, a.x - c.cx);
  const ab = wrap(Math.atan2(b.y - c.cy, b.x - c.cx) - ta);
  const av = wrap(Math.atan2(via.y - c.cy, via.x - c.cx) - ta);
  const span = av < ab ? ab : ab - TAU;
  const out: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = ta + (span * i) / n;
    out.push({ x: c.cx + c.r * Math.cos(t), y: c.cy + c.r * Math.sin(t) });
  }
  return out;
}

/** Smooth path through freehand points. */
export function strokePath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length < 3) return `M${points[0].x} ${points[0].y} ` + points.map((p) => `L${p.x} ${p.y}`).join(' ');
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q${points[i].x} ${points[i].y} ${mx} ${my}`;
  }
  const last = points[points.length - 1];
  return `${d} L${last.x} ${last.y}`;
}

function distanceToPolyline(p: Point, pts: Point[]): number {
  if (pts.length === 1) return distance(p, pts[0]);
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) best = Math.min(best, distanceToSegment(p, pts[i - 1], pts[i]));
  return best;
}

/** Shape of a drawn line as points (straight lines give their two ends). */
function shapeOf(l: DrawnLine): Point[] {
  if (l.kind === 'stroke' && l.points) return l.points;
  if (l.kind === 'arc' && l.via) return arcPoints({ x: l.x1, y: l.y1 }, { x: l.x2, y: l.y2 }, l.via);
  return [
    { x: l.x1, y: l.y1 },
    { x: l.x2, y: l.y2 },
  ];
}

// ---------- attachment of lines to points ----------

function guideAttached(g: Guide, star: SavedStar): boolean {
  if (g.starId) return g.starId === star.id;
  // Photos saved before guides remembered their point: match by color and geometry.
  return g.color === star.color && distanceToLine(star, g) < 2;
}

/** The point a straight line or guide hangs from, if any. */
export function anchorOf(doc: EditDoc, sel: Selection): SavedStar | null {
  const stars = doc.overlay.stars;
  if (sel.kind === 'line') {
    const l = doc.lines.find((x) => x.id === sel.id);
    if (!l || l.kind) return null;
    return (l.starId && stars.find((s) => s.id === l.starId)) || null;
  }
  if (sel.kind === 'guide') {
    const g = doc.overlay.guides[sel.index];
    return (g && stars.find((s) => guideAttached(g, s))) || null;
  }
  return null;
}

function farEnd(s: Seg, from: Point): Point {
  const a = { x: s.x1, y: s.y1 };
  const b = { x: s.x2, y: s.y2 };
  return distance(a, from) > distance(b, from) ? a : b;
}

/** Re-draws a line that hangs from `from` so it starts at `to` and passes through `through`. */
function aim<T extends Seg>(s: T, from: Point, to: Point, through: Point, o: Overlay): T {
  // The point sat between both ends (a full line through it) or at one end (a ray from it).
  const between = (s.x1 - from.x) * (s.x2 - from.x) + (s.y1 - from.y) * (s.y2 - from.y) < 0;
  const d = unit(through.x - to.x, through.y - to.y);
  if (!d) return s;
  const seg = between ? clipLine(to, d, rectOf(o)) : clipRay(to, d, rectOf(o));
  return seg ? { ...s, ...seg } : s;
}

/** Moves a vanishing point; its lines, guides and arcs follow. */
export function moveStar(doc: EditDoc, id: string, to: Point): EditDoc {
  const o = doc.overlay;
  const star = o.stars.find((s) => s.id === id);
  if (!star) return doc;
  const from = { x: star.x, y: star.y };
  return {
    lines: doc.lines.map((l) => {
      if (l.kind === 'arc') {
        if (l.starId === id) return { ...l, x1: to.x, y1: to.y };
        if (l.starId2 === id) return { ...l, x2: to.x, y2: to.y };
        return l;
      }
      if (!l.kind && l.starId === id) return aim(l, from, to, farEnd(l, from), o);
      return l;
    }),
    overlay: {
      ...o,
      stars: o.stars.map((s) => (s.id === id ? { ...s, x: to.x, y: to.y } : s)),
      guides: o.guides.map((g) => (guideAttached(g, star) ? aim(g, from, to, farEnd(g, from), o) : g)),
    },
  };
}

/** Adds a point; it starts on the horizon when there is one, then moves freely. */
export function addStar(doc: EditDoc, star: SavedStar): EditDoc {
  const o = doc.overlay;
  const pos = o.horizon ? projectOnHorizon(o.horizon, star) : { x: star.x, y: star.y };
  return { ...doc, overlay: { ...o, stars: [...o.stars, { ...star, x: pos.x, y: pos.y }] } };
}

// ---------- selections ----------

/** Segment for a straight selection (lines, guides, horizon). */
export function segmentOf(doc: EditDoc, sel: Selection): Seg | null {
  if (sel.kind === 'line') {
    const l = doc.lines.find((x) => x.id === sel.id);
    return l && !l.kind ? l : null;
  }
  if (sel.kind === 'guide') return doc.overlay.guides[sel.index] ?? null;
  if (sel.kind === 'horizon') return horizonHandles(doc.overlay);
  return null;
}

export function exists(doc: EditDoc, sel: Selection | null): boolean {
  if (!sel) return false;
  if (sel.kind === 'star') return doc.overlay.stars.some((s) => s.id === sel.id);
  if (sel.kind === 'line') return doc.lines.some((l) => l.id === sel.id);
  return segmentOf(doc, sel) !== null;
}

/** Drag handles: an attached line only has its far end, an arc has its bend point. */
export function handlesOf(doc: EditDoc, sel: Selection): Point[] {
  if (sel.kind === 'line') {
    const l = doc.lines.find((x) => x.id === sel.id);
    if (l?.kind === 'arc' && l.via) return [l.via];
    if (l?.kind === 'stroke') return [];
  }
  const s = segmentOf(doc, sel);
  if (!s) return [];
  const anchor = anchorOf(doc, sel);
  if (anchor) return [farEnd(s, anchor)];
  return [
    { x: s.x1, y: s.y1 },
    { x: s.x2, y: s.y2 },
  ];
}

function shift<T extends Seg>(s: T, dx: number, dy: number): T {
  return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
}

function shiftLine(l: DrawnLine, dx: number, dy: number): DrawnLine {
  if (l.kind === 'stroke') {
    return { ...shift(l, dx, dy), points: l.points?.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
  }
  if (l.kind === 'arc') {
    // Arcs stay pinned to FE1/FE2: moving one bends it instead.
    return l.via ? { ...l, via: { x: l.via.x + dx, y: l.via.y + dy } } : l;
  }
  return shift(l, dx, dy);
}

/** Turns an attached line around its point so it passes through `through`. */
function aimAt(doc: EditDoc, sel: Selection, through: Point): EditDoc {
  const anchor = anchorOf(doc, sel);
  if (!anchor) return doc;
  const o = doc.overlay;
  if (sel.kind === 'line') {
    return { ...doc, lines: doc.lines.map((l) => (l.id === sel.id ? aim(l, anchor, anchor, through, o) : l)) };
  }
  if (sel.kind === 'guide') {
    return {
      ...doc,
      overlay: { ...o, guides: o.guides.map((g, i) => (i === sel.index ? aim(g, anchor, anchor, through, o) : g)) },
    };
  }
  return doc;
}

/** Moves the selection by (dx, dy) units from the state in `doc`. */
export function drag(doc: EditDoc, sel: Selection, dx: number, dy: number): EditDoc {
  const o = doc.overlay;
  switch (sel.kind) {
    case 'star': {
      const s = o.stars.find((st) => st.id === sel.id);
      return s ? moveStar(doc, sel.id, { x: s.x + dx, y: s.y + dy }) : doc;
    }
    case 'line':
    case 'guide': {
      const anchor = anchorOf(doc, sel);
      const seg = segmentOf(doc, sel);
      if (anchor && seg) {
        const end = farEnd(seg, anchor);
        return aimAt(doc, sel, { x: end.x + dx, y: end.y + dy });
      }
      if (sel.kind === 'line') return { ...doc, lines: doc.lines.map((l) => (l.id === sel.id ? shiftLine(l, dx, dy) : l)) };
      return { ...doc, overlay: { ...o, guides: o.guides.map((g, i) => (i === sel.index ? shift(g, dx, dy) : g)) } };
    }
    case 'horizon':
      return o.horizon ? { ...doc, overlay: { ...o, horizon: shift(o.horizon, dx, dy) } } : doc;
  }
}

/** Drags handle `index` (from handlesOf) to p. */
export function dragHandle(doc: EditDoc, sel: Selection, index: number, p: Point): EditDoc {
  if (anchorOf(doc, sel)) return aimAt(doc, sel, p);
  const o = doc.overlay;
  const place = <T extends Seg>(s: T): T => (index === 0 ? { ...s, x1: p.x, y1: p.y } : { ...s, x2: p.x, y2: p.y });
  switch (sel.kind) {
    case 'line':
      return {
        ...doc,
        lines: doc.lines.map((l) => {
          if (l.id !== sel.id) return l;
          if (l.kind === 'arc') return { ...l, via: p };
          if (l.kind === 'stroke') return l;
          return place(l);
        }),
      };
    case 'guide':
      return { ...doc, overlay: { ...o, guides: o.guides.map((g, i) => (i === sel.index ? place(g) : g)) } };
    case 'horizon': {
      const h = horizonHandles(o);
      if (!h) return doc;
      const moved = place(h);
      const long = extendHorizon({ x: moved.x1, y: moved.y1 }, { x: moved.x2, y: moved.y2 });
      return long ? { ...doc, overlay: { ...o, horizon: long } } : doc;
    }
    default:
      return doc;
  }
}

/** Moves a point away from (factor > 1) or toward (factor < 1) the center of the photo. */
export function pushStar(doc: EditDoc, id: string, factor: number): EditDoc {
  const s = doc.overlay.stars.find((st) => st.id === id);
  if (!s) return doc;
  const c = { x: OVERLAY_WIDTH / 2, y: doc.overlay.height / 2 };
  return moveStar(doc, id, { x: c.x + (s.x - c.x) * factor, y: c.y + (s.y - c.y) * factor });
}

/** Deletes the selection. A point takes its lines, guides and arcs with it. */
export function remove(doc: EditDoc, sel: Selection): EditDoc {
  const o = doc.overlay;
  switch (sel.kind) {
    case 'line':
      return { ...doc, lines: doc.lines.filter((l) => l.id !== sel.id) };
    case 'guide':
      return { ...doc, overlay: { ...o, guides: o.guides.filter((_, i) => i !== sel.index) } };
    case 'horizon':
      return { ...doc, overlay: { ...o, horizon: null } };
    case 'star': {
      const star = o.stars.find((s) => s.id === sel.id);
      if (!star) return doc;
      return {
        lines: doc.lines.filter((l) => l.starId !== star.id && l.starId2 !== star.id),
        overlay: {
          ...o,
          stars: o.stars.filter((s) => s.id !== star.id),
          guides: o.guides.filter((g) => !guideAttached(g, star)),
        },
      };
    }
  }
}

/** How many lines, guides and arcs hang from a point. */
export function attachedCount(doc: EditDoc, id: string): number {
  const star = doc.overlay.stars.find((s) => s.id === id);
  if (!star) return 0;
  return (
    doc.lines.filter((l) => l.starId === id || l.starId2 === id).length +
    doc.overlay.guides.filter((g) => guideAttached(g, star)).length
  );
}

/** What is under the finger: points first, then drawn lines, guides and the horizon. */
export function hitTest(doc: EditDoc, p: Point, starTol: number, lineTol: number): Selection | null {
  const o = doc.overlay;
  let best: { sel: Selection; d: number } | null = null;
  for (const s of o.stars) {
    const d = distance(p, s);
    if (d < starTol && (!best || d < best.d)) best = { sel: { kind: 'star', id: s.id }, d };
  }
  if (best) return best.sel;

  for (let i = doc.lines.length - 1; i >= 0; i--) {
    const l = doc.lines[i];
    if (distanceToPolyline(p, shapeOf(l)) < lineTol + l.width / 2) return { kind: 'line', id: l.id };
  }
  const guideHit = (strong: boolean) => {
    let found: { index: number; d: number } | null = null;
    o.guides.forEach((g, index) => {
      if (g.opacity >= 0.5 !== strong) return;
      const d = distanceToSegment(p, { x: g.x1, y: g.y1 }, { x: g.x2, y: g.y2 });
      if (d < lineTol && (!found || d < found.d)) found = { index, d };
    });
    return found as { index: number; d: number } | null;
  };
  const strong = guideHit(true);
  if (strong) return { kind: 'guide', index: strong.index };
  const h = o.horizon;
  if (h && distanceToSegment(p, { x: h.x1, y: h.y1 }, { x: h.x2, y: h.y2 }) < lineTol) return { kind: 'horizon' };
  const faint = guideHit(false);
  if (faint) return { kind: 'guide', index: faint.index };
  return null;
}

/** Which handle of the selection is under the finger, if any. */
export function hitHandle(doc: EditDoc, sel: Selection, p: Point, tol: number): number | null {
  let best: number | null = null;
  let bestD = tol;
  handlesOf(doc, sel).forEach((h, i) => {
    const d = distance(p, h);
    if (d < bestD) {
      best = i;
      bestD = d;
    }
  });
  return best;
}

export type Extension = Seg & { color: string; width: number };

/**
 * For points outside the photo: the part of each attached line between the photo edge
 * and its point, so you can follow the lines all the way to the point when zoomed out.
 */
export function extensionsFor(doc: EditDoc): Extension[] {
  const o = doc.overlay;
  const out: Extension[] = [];
  for (const star of o.stars) {
    if (insidePhoto(o, star)) continue;
    const add = (s: Seg, color: string, width: number) => {
      const a = { x: s.x1, y: s.y1 };
      const b = { x: s.x2, y: s.y2 };
      const near = distance(a, star) < distance(b, star) ? a : b;
      if (distance(near, star) > 1) out.push({ x1: star.x, y1: star.y, x2: near.x, y2: near.y, color, width });
    };
    for (const l of doc.lines) if (!l.kind && l.starId === star.id) add(l, l.color, l.width);
    for (const g of o.guides) if (guideAttached(g, star) && g.opacity >= 0.5) add(g, g.color, g.width);
  }
  return out;
}

/** Bounding box of the photo plus the given points (ignoring points at "infinity"). */
export function contentBounds(o: Overlay, points: Point[]) {
  let minX = 0;
  let minY = 0;
  let maxX = OVERLAY_WIDTH;
  let maxY = o.height;
  for (const p of points) {
    if (Math.abs(p.x) > FAR_LIMIT || Math.abs(p.y) > FAR_LIMIT) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Marks moved points as visible when they now sit inside the photo. */
export function finalizeOverlay(edited: Overlay, original: Overlay): Overlay {
  return {
    ...edited,
    stars: edited.stars.map((s) => {
      const before = original.stars.find((b) => b.id === s.id);
      if (before && before.x === s.x && before.y === s.y) return s;
      return { ...s, visible: insidePhoto(edited, s) };
    }),
  };
}
