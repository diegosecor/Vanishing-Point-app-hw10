import { Platform } from 'react-native';

/** "Radioactive" blue used for all menu lettering. */
export const BLUE = '#0050FF';
export const WHITE = '#FFFFFF';
export const INK = '#0B0B0F';
export const MUTED = '#8A8F98';
export const HAIRLINE = '#E6E8EC';
export const DANGER = '#E5243B';
export const LEVEL_OK = '#00D26A';
export const LEVEL_OFF = '#FFB020';

/** Avenir for regular text, a terminal-style monospace font for data/labels. */
export const Fonts = {
  sans: Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif',
    default: 'Avenir Next, Avenir, Helvetica Neue, sans-serif',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'Menlo, Consolas, monospace',
  }),
};

/** Classic vanishing points (camera and editor). */
export const STAR_LABELS = ['VP1', 'VP2', 'VP3'] as const;
/** Fisheye (curvilinear) pair: every line becomes an arc through both points. */
export const FISHEYE_LABELS = ['FE1', 'FE2'] as const;
export const POINT_LABELS = [...STAR_LABELS, ...FISHEYE_LABELS] as const;

/** Pantone-inspired colors (approximate sRGB of the named Pantone C swatches). */
export const STAR_COLORS: Record<(typeof POINT_LABELS)[number], string> = {
  VP1: '#FE5000', // Orange 021
  VP2: '#0057B8', // 2935
  VP3: '#EF3340', // Red 032
  FE1: '#F1C400', // 7406
  FE2: '#F1C400',
};

/** Horizon line color (Pantone 2995). */
export const HORIZON_COLOR = '#00A9E0';

/** Palette for editor lines: oranges, yellows, reds and blues, plus white and black. */
export const LINE_PALETTE = [
  '#FE5000', // Orange 021
  '#FF8200', // 151
  '#FFC72C', // 123
  '#EF3340', // Red 032
  '#C8102E', // 186
  '#00A9E0', // 2995
  '#0057B8', // 2935
  '#001E62', // 2758
  '#FFFFFF',
  '#0B0B0F',
];

/** Dark or light text, whichever reads better on a colored chip. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170 ? '#0B0B0F' : '#FFFFFF';
}

/** Line thickness options, in overlay units (overlay is 1000 units wide). */
export const LINE_WIDTHS = [
  { label: 'XS', value: 2 },
  { label: 'S', value: 4 },
  { label: 'M', value: 8 },
  { label: 'L', value: 14 },
  { label: 'XL', value: 22 },
];

export const LINE_STYLES = ['solid', 'dotted', 'dashed'] as const;
