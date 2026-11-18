/**
 * 3D camera math. Vanishing points are stored as directions in the world
 * (fixed to compass + gravity), so they stay put when the phone turns and
 * can leave the screen and come back.
 *
 * Device frame: x = right edge, y = top edge, z = out of the screen.
 * World frame:  z = up (gravity), x/y horizontal.
 * The back camera looks along device -z.
 */
import type { Point } from './types';

export type Vec3 = [number, number, number];
/** Row-major 3x3 rotation matrix mapping device coordinates to world coordinates. */
export type Mat3 = number[];

export type Camera = {
  R: Mat3;
  /** Focal length in screen px. */
  f: number;
  cx: number;
  cy: number;
  /** Manual calibration shift applied to everything projected (px). */
  shift: Point;
};

export type Rect = { w: number; h: number };

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Rotation from Euler angles in Z-X'-Y'' order (what iOS CoreMotion and the W3C spec use). */
export function eulerToMatrix(alpha: number, beta: number, gamma: number): Mat3 {
  const ca = Math.cos(alpha);
  const sa = Math.sin(alpha);
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  const cg = Math.cos(gamma);
  const sg = Math.sin(gamma);
  // M = Rx(beta) * Ry(gamma)
  const m0 = [cg, 0, sg];
  const m1 = [sb * sg, cb, -sb * cg];
  const m2 = [-cb * sg, sb, cb * cg];
  return [
    ca * m0[0] - sa * m1[0],
    ca * m0[1] - sa * m1[1],
    ca * m0[2] - sa * m1[2],
    sa * m0[0] + ca * m1[0],
    sa * m0[1] + ca * m1[1],
    sa * m0[2] + ca * m1[2],
    m2[0],
    m2[1],
    m2[2],
  ];
}

export function normalize(v: Vec3): Vec3 | null {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (l < 1e-9) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Blend two rotations and re-orthonormalize (low-pass filter for sensor noise). */
export function blendRotation(prev: Mat3, next: Mat3, k: number): Mat3 {
  const m = prev.map((v, i) => v + (next[i] - v) * k);
  const r0 = normalize([m[0], m[1], m[2]]) ?? [1, 0, 0];
  const raw1: Vec3 = [m[3], m[4], m[5]];
  const d = dot(r0, raw1);
  const r1 = normalize([raw1[0] - d * r0[0], raw1[1] - d * r0[1], raw1[2] - d * r0[2]]) ?? [0, 1, 0];
  const r2 = cross(r0, r1);
  return [...r0, ...r1, ...r2];
}

/** World vector -> device frame (R transposed). */
export function toDevice(R: Mat3, w: Vec3): Vec3 {
  return [
    R[0] * w[0] + R[3] * w[1] + R[6] * w[2],
    R[1] * w[0] + R[4] * w[1] + R[7] * w[2],
    R[2] * w[0] + R[5] * w[1] + R[8] * w[2],
  ];
}

/** Device vector -> world frame. */
export function toWorld(R: Mat3, d: Vec3): Vec3 {
  return [
    R[0] * d[0] + R[1] * d[1] + R[2] * d[2],
    R[3] * d[0] + R[4] * d[1] + R[5] * d[2],
    R[6] * d[0] + R[7] * d[1] + R[8] * d[2],
  ];
}

const LIMIT = 1e5;
const clampCoord = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));

/**
 * Screen position of the vanishing point of a world direction. Parallel lines
 * meet at the same image point for d and -d, so points behind the camera are
 * still valid vanishing points (inFront tells them apart).
 */
export function project(cam: Camera, w: Vec3): { point: Point; inFront: boolean } {
  const d = toDevice(cam.R, w);
  let den = -d[2];
  const inFront = den > 0;
  if (Math.abs(den) < 1e-6) den = den < 0 ? -1e-6 : 1e-6;
  return {
    point: {
      x: clampCoord(cam.cx + (cam.f * d[0]) / den + cam.shift.x),
      y: clampCoord(cam.cy - (cam.f * d[1]) / den + cam.shift.y),
    },
    inFront,
  };
}

/** World direction seen at a screen point. */
export function unproject(cam: Camera, p: Point): Vec3 {
  const x = p.x - cam.shift.x;
  const y = p.y - cam.shift.y;
  const d: Vec3 = [(x - cam.cx) / cam.f, -(y - cam.cy) / cam.f, -1];
  return normalize(toWorld(cam.R, d)) ?? [0, 0, -1];
}

/**
 * Image of a world plane through the camera (given by its normal) — a straight
 * line on screen. Returns the point closest to the frame center and a unit
 * direction, or null when the plane faces the camera head-on.
 */
export function planeLine(cam: Camera, nWorld: Vec3): { p: Point; dir: Point } | null {
  const n = toDevice(cam.R, nWorld);
  const a = n[0] / cam.f;
  const b = -n[1] / cam.f;
  const ab2 = a * a + b * b;
  if (ab2 < 1e-12) return null;
  // Line: a*(x-cx) + b*(y-cy) - n.z = 0
  const t = n[2] / ab2;
  const len = Math.sqrt(ab2);
  return {
    p: { x: cam.cx + a * t + cam.shift.x, y: cam.cy + b * t + cam.shift.y },
    dir: { x: -b / len, y: a / len },
  };
}

/** Liang–Barsky: parameter range of p + t*dir inside the rect, limited to [tMin, tMax]. */
function clipRange(p: Point, dir: Point, rect: Rect, tMin: number, tMax: number): [number, number] | null {
  let t0 = tMin;
  let t1 = tMax;
  const checks: [number, number][] = [
    [-dir.x, p.x],
    [dir.x, rect.w - p.x],
    [-dir.y, p.y],
    [dir.y, rect.h - p.y],
  ];
  for (const [pp, q] of checks) {
    if (Math.abs(pp) < 1e-12) {
      if (q < 0) return null;
    } else {
      const r = q / pp;
      if (pp < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return t0 <= t1 ? [t0, t1] : null;
}

const BIG = 1e7;

function segment(p: Point, dir: Point, range: [number, number] | null) {
  if (!range) return null;
  return {
    x1: p.x + dir.x * range[0],
    y1: p.y + dir.y * range[0],
    x2: p.x + dir.x * range[1],
    y2: p.y + dir.y * range[1],
  };
}

/** Part of an infinite line inside the rect. */
export function clipLine(p: Point, dir: Point, rect: Rect) {
  return segment(p, dir, clipRange(p, dir, rect, -BIG, BIG));
}

/** Part of a ray (from p toward dir) inside the rect. */
export function clipRay(p: Point, dir: Point, rect: Rect) {
  return segment(p, dir, clipRange(p, dir, rect, 0, BIG));
}

// ---------- screen orientation for the UI (app stays locked to portrait) ----------

export type UiRotation = 0 | 90 | -90;

/**
 * Which way text should be rotated so it reads upright, from the "up" vector
 * in device coordinates. Hysteresis avoids flicker near 45 degrees.
 */
export function nextUiRotation(prev: UiRotation, ux: number, uy: number, uz: number): UiRotation {
  if (Math.abs(uz) > 0.9) return prev; // lying flat: keep what we had
  if (Math.abs(ux) > Math.abs(uy) + 0.25) return ux > 0 ? 90 : -90;
  if (Math.abs(uy) > Math.abs(ux) + 0.25) return 0;
  return prev;
}
