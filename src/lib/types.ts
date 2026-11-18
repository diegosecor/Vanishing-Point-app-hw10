import type { LINE_STYLES, STAR_LABELS } from '@/constants/style';

export type Perspective = 1 | 2 | 3;
export type LineStyle = (typeof LINE_STYLES)[number];
export type StarLabel = (typeof STAR_LABELS)[number];

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
  x: number;
  y: number;
  /** Angle (radians) of the horizon direction when captured; fan lines are relative to it. */
  angle: number;
  /** Index (0-11) of the selected fan line, or null. */
  selectedLine: number | null;
};

export type Overlay = {
  /** Frame height in units (width is always OVERLAY_WIDTH). */
  height: number;
  horizon: { x1: number; y1: number; x2: number; y2: number };
  stars: SavedStar[];
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
