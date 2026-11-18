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

/** VP1, VP2, VP3 colors. */
export const STAR_LABELS = ['VP1', 'VP2', 'VP3'] as const;
export const STAR_COLORS: Record<(typeof STAR_LABELS)[number], string> = {
  VP1: '#FF3D00',
  VP2: '#00C853',
  VP3: '#D500F9',
};

/** Palette for editor lines. */
export const LINE_PALETTE = [
  '#0050FF',
  '#FF3D00',
  '#00C853',
  '#D500F9',
  '#FFD600',
  '#00E5FF',
  '#FFFFFF',
  '#0B0B0F',
];

/** Line thickness options, in overlay units (overlay is 1000 units wide). */
export const LINE_WIDTHS = [
  { label: 'S', value: 4 },
  { label: 'M', value: 8 },
  { label: 'L', value: 14 },
  { label: 'XL', value: 22 },
];

export const LINE_STYLES = ['solid', 'dotted', 'dashed'] as const;
