import type { LINE_STYLES, POINT_LABELS } from '@/constants/style';

export type Perspective = 1 | 2 | 3;
export type LineStyle = (typeof LINE_STYLES)[number];
export type StarLabel = (typeof POINT_LABELS)[number];

export type Point = { x: number; y: number };

/**
 * Overlay coordinates are stored in "units": the frame is always OVERLAY_WIDTH
 * units wide and `height` units tall, so it scales to any display size.
 */
export const OVERLAY_WIDTH = 1000;

export type SavedStar = {
  id: string;
  label: StarLabel;
  color: string;
  /** Vanishing point position in overlay units; may be far outside the frame. */
  x: number;
  y: number;
  /** Whether the point marker itself is drawn (it is in view and in front of the camera). */
  visible: boolean;
};

/** A guide line already clipped to the frame, in overlay units. */
export type Guide = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  opacity: number;
  /** The vanishing point this guide starts from, so it follows when the point is moved. */
  starId?: string;
};

export type Overlay = {
  /** Frame height in units (width is always OVERLAY_WIDTH). */
  height: number;
  /** Long horizon segment, or null when the horizon is out of view (camera pointing straight up/down). */
  horizon: { x1: number; y1: number; x2: number; y2: number } | null;
  stars: SavedStar[];
  guides: Guide[];
};

export type DrawnLine = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  style: LineStyle;
  color: string;
  /** Set when the line was drawn from a vanishing point; it follows when the point is moved. */
  starId?: string;
  /** Straight line (default), a fisheye 'arc' through two points, or a freehand brush 'stroke'. */
  kind?: 'arc' | 'stroke';
  /** Arc: the second fisheye point (the first is starId). x1/y1 and x2/y2 are the two points. */
  starId2?: string;
  /** Arc: a point the arc passes through (sets how much it bends). */
  via?: Point;
  /** Stroke: the freehand path. */
  points?: Point[];
};

export type PhotoEntry = {
  id: string;
  /** File name inside the app's private photos folder (not a full URI: the sandbox path can change). */
  fileName: string;
  createdAt: number;
  updatedAt: number;
  perspective: Perspective;
  overlay: Overlay;
  lines: DrawnLine[];
};

export type Settings = {
  perspective: Perspective;
  lineWidth: number;
  lineStyle: LineStyle;
  lineColor: string;
};

/** A freshly taken photo that has not been saved to the gallery yet. */
export type Draft = {
  uri: string;
  createdAt: number;
  perspective: Perspective;
  overlay: Overlay;
};
