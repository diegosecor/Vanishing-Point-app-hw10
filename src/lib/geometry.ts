import type { Point } from './types';

export const FAN_LINE_COUNT = 12;
/** Fan lines are offset by 15 degrees so none of them lies on the horizon itself. */
export const FAN_OFFSET = Math.PI / 12;
export const FAN_STEP = (2 * Math.PI) / FAN_LINE_COUNT;
/** Long enough to always reach the edge of the frame. */
export const FAR = 20000;

export type HorizonFrame = {
  /** Point on the horizon closest to the frame center. */
  origin: Point;
  /** Unit vector along the horizon (screen "right"). */
  dir: Point;
  /** Unit vector perpendicular to the horizon, pointing screen "down". */
  normal: Point;
};

export function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function fanAngle(baseAngle: number, index: number): number {
  return baseAngle + FAN_OFFSET + index * FAN_STEP;
}

export function fanEnd(origin: Point, baseAngle: number, index: number, length = FAR): Point {
  const a = fanAngle(baseAngle, index);
  return { x: origin.x + Math.cos(a) * length, y: origin.y + Math.sin(a) * length };
}

/** Point on the horizon frame at coordinates (t along, s across). */
export function framePoint(h: HorizonFrame, t: number, s: number): Point {
  return {
    x: h.origin.x + h.dir.x * t + h.normal.x * s,
    y: h.origin.y + h.dir.y * t + h.normal.y * s,
  };
}

/** Inverse of framePoint. */
export function toFrame(h: HorizonFrame, p: Point): { t: number; s: number } {
  const dx = p.x - h.origin.x;
  const dy = p.y - h.origin.y;
  return { t: dx * h.dir.x + dy * h.dir.y, s: dx * h.normal.x + dy * h.normal.y };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return distance(p, { x: a.x + vx * t, y: a.y + vy * t });
}

/** Points for a 5-point star polygon. */
export function starPolygon(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return pts.join(' ');
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}
