import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import { Fonts } from '@/constants/style';
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
  /** Rotation (deg) for the point labels so they read upright in landscape. */
  labelRotation?: number;
};

export const POINT_RADIUS = 20;

export function dashFor(line: Pick<DrawnLine, 'style' | 'width'>): string | undefined {
  if (line.style === 'dotted') return `0 ${line.width * 2.2}`;
  if (line.style === 'dashed') return `${line.width * 3} ${line.width * 2}`;
  return undefined;
}

function DrawnLineView({ line }: { line: DrawnLine }) {
  return (
    <Line
      x1={line.x1}
      y1={line.y1}
      x2={line.x2}
      y2={line.y2}
      stroke={line.color}
      strokeWidth={line.width}
      strokeDasharray={dashFor(line)}
      strokeLinecap={line.style === 'dashed' ? 'butt' : 'round'}
    />
  );
}

/** Renders horizon, guide lines, vanishing points (circles) and drawn lines, in overlay units. */
export const OverlayLayer = memo(function OverlayLayer({
  overlay,
  lines,
  pendingLine,
  compact,
  activeStarId,
  labelRotation = 0,
}: Props) {
  const k = compact ? 2.2 : 1;
  const { horizon } = overlay;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${OVERLAY_WIDTH} ${overlay.height}`}
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      {horizon && (
        <Line
          x1={horizon.x1}
          y1={horizon.y1}
          x2={horizon.x2}
          y2={horizon.y2}
          stroke="#00E5FF"
          strokeWidth={4 * k}
          strokeOpacity={0.95}
        />
      )}
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
      {overlay.stars
        .filter((s) => s.visible)
        .map((star) => (
          <G key={star.id}>
            {star.id === activeStarId && (
              <Circle
                cx={star.x}
                cy={star.y}
                r={POINT_RADIUS + 9}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth={4}
              />
            )}
            <Circle
              cx={star.x}
              cy={star.y}
              r={POINT_RADIUS * (compact ? 1.4 : 1)}
              fill={star.color}
              stroke="#FFFFFF"
              strokeWidth={3 * k}
            />
            {!compact && (
              <G rotation={labelRotation} origin={`${star.x}, ${star.y}`}>
                <SvgText
                  x={star.x + POINT_RADIUS + 10}
                  y={star.y - POINT_RADIUS}
                  fill="#FFFFFF"
                  stroke="#000000"
                  strokeWidth={0.8}
                  fontSize={30}
                  fontWeight="bold"
                  fontFamily={Fonts.mono}
                >
                  {star.label}
                </SvgText>
              </G>
            )}
          </G>
        ))}
      {lines?.map((line) => (
        <DrawnLineView key={line.id} line={line} />
      ))}
      {pendingLine && <DrawnLineView line={pendingLine} />}
    </Svg>
  );
});
