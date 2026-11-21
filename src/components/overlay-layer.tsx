import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { Fonts, HORIZON_COLOR } from '@/constants/style';
import { arcPath, strokePath, type Extension } from '@/lib/edit';
import { OVERLAY_WIDTH, type DrawnLine, type Overlay } from '@/lib/types';

type Props = {
  overlay: Overlay;
  lines?: DrawnLine[];
  /** Line currently being drawn (not committed yet). */
  pendingLine?: DrawnLine | null;
  /** Thicker strokes for tiny thumbnails. */
  compact?: boolean;
  /** Highlights this point with a ring (the active point). */
  activeStarId?: string | null;
  /** Draws a blue glow under this drawn line (the selected one). */
  highlightLineId?: string | null;
  /** Rotation (deg) for the point labels so they read upright in landscape. */
  labelRotation?: number;
  /** Custom visible region in overlay units (the editor uses it to zoom and to show points outside the photo). */
  viewBox?: string;
  /** Multiplies point size and label size (keeps points readable when zoomed). */
  markerScale?: number;
  /** Multiplies stroke widths (keeps thin lines visible when zoomed out). */
  lineScale?: number;
  /** Draw every point, including ones outside the photo (editor). */
  showAllStars?: boolean;
  /** Dashed continuations from the photo edge to points outside it (editor). */
  extensions?: Extension[];
  /** 'cover' crops like the photo thumbnail does (gallery); default stretches to the box. */
  fit?: 'stretch' | 'cover';
};

export const POINT_RADIUS = 20;
const HIGHLIGHT = '#0050FF';

export function dashFor(line: Pick<DrawnLine, 'style' | 'width'>): string | undefined {
  if (line.style === 'dotted') return `0 ${line.width * 2.2}`;
  if (line.style === 'dashed') return `${line.width * 3} ${line.width * 2}`;
  return undefined;
}

function DrawnLineView({ line, scale = 1, glow = 0 }: { line: DrawnLine; scale?: number; glow?: number }) {
  const width = line.width * scale + glow;
  const common = glow
    ? { stroke: HIGHLIGHT, strokeOpacity: 0.35, strokeWidth: width, strokeLinecap: 'round' as const, fill: 'none' }
    : {
        stroke: line.color,
        strokeWidth: width,
        strokeDasharray: line.kind === 'stroke' ? undefined : dashFor({ style: line.style, width }),
        strokeLinecap: line.style === 'dashed' ? ('butt' as const) : ('round' as const),
        strokeLinejoin: 'round' as const,
        fill: 'none',
      };
  if (line.kind === 'stroke' && line.points) return <Path d={strokePath(line.points)} {...common} />;
  if (line.kind === 'arc' && line.via) {
    return <Path d={arcPath({ x: line.x1, y: line.y1 }, { x: line.x2, y: line.y2 }, line.via)} {...common} />;
  }
  return <Line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} {...common} />;
}

/** Renders horizon, guide lines, vanishing points (circles) and drawn lines, in overlay units. */
export const OverlayLayer = memo(function OverlayLayer({
  overlay,
  lines,
  pendingLine,
  compact,
  activeStarId,
  highlightLineId,
  labelRotation = 0,
  viewBox,
  markerScale = 1,
  lineScale = 1,
  showAllStars,
  extensions,
  fit = 'stretch',
}: Props) {
  const k = (compact ? 2.2 : 1) * lineScale;
  const m = markerScale;
  const { horizon } = overlay;
  const highlighted = highlightLineId ? lines?.find((l) => l.id === highlightLineId) : undefined;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox={viewBox ?? `0 0 ${OVERLAY_WIDTH} ${overlay.height}`}
      preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'none'}
      pointerEvents="none"
    >
      {horizon && (
        <Line
          x1={horizon.x1}
          y1={horizon.y1}
          x2={horizon.x2}
          y2={horizon.y2}
          stroke={HORIZON_COLOR}
          strokeWidth={4 * k}
          strokeOpacity={0.95}
        />
      )}
      {extensions?.map((e, i) => (
        <Line
          key={`x${i}`}
          x1={e.x1}
          y1={e.y1}
          x2={e.x2}
          y2={e.y2}
          stroke={e.color}
          strokeWidth={Math.max(1.5, e.width * 0.6) * lineScale}
          strokeOpacity={0.6}
          strokeDasharray={`${10 * lineScale} ${8 * lineScale}`}
        />
      ))}
      {overlay.guides.map((g, i) => (
        <Line
          key={i}
          x1={g.x1}
          y1={g.y1}
          x2={g.x2}
          y2={g.y2}
          stroke={g.color}
          strokeWidth={g.width * k}
          strokeOpacity={g.opacity}
        />
      ))}
      {highlighted && <DrawnLineView line={highlighted} scale={lineScale} glow={14 * m} />}
      {lines?.map((line) => (
        <DrawnLineView key={line.id} line={line} scale={lineScale} />
      ))}
      {pendingLine && <DrawnLineView line={pendingLine} scale={lineScale} />}
      {overlay.stars
        .filter((s) => showAllStars || s.visible)
        .map((star) => (
          <G key={star.id}>
            {star.id === activeStarId && (
              <Circle
                cx={star.x}
                cy={star.y}
                r={(POINT_RADIUS + 9) * m}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={4 * m}
              />
            )}
            <Circle
              cx={star.x}
              cy={star.y}
              r={POINT_RADIUS * (compact ? 1.4 : 1) * m}
              fill={star.color}
              stroke="#FFFFFF"
              strokeWidth={3 * (compact ? 2.2 : 1) * m}
            />
            {!compact && (
              <G rotation={labelRotation} origin={`${star.x}, ${star.y}`}>
                <SvgText
                  x={star.x + (POINT_RADIUS + 10) * m}
                  y={star.y - POINT_RADIUS * m}
                  fill="#FFFFFF"
                  stroke="#000000"
                  strokeWidth={0.8 * m}
                  fontSize={30 * m}
                  fontWeight="bold"
                  fontFamily={Fonts.mono}
                >
                  {star.label}
                </SvgText>
              </G>
            )}
          </G>
        ))}
    </Svg>
  );
});
