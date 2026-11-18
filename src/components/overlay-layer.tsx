import { memo } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { G, Line, Polygon, Text as SvgText } from 'react-native-svg';

import { Fonts } from '@/constants/style';
import { FAN_LINE_COUNT, fanEnd, starPolygon } from '@/lib/geometry';
import { OVERLAY_WIDTH, type DrawnLine, type Overlay } from '@/lib/types';

type Props = {
  overlay: Overlay;
  lines?: DrawnLine[];
  /** Line currently being drawn (not committed yet). */
  pendingLine?: DrawnLine | null;
  /** Thin horizon/fan strokes are scaled up for tiny thumbnails. */
  compact?: boolean;
};

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

/** Renders horizon, stars with their 12 fan lines, and drawn lines in overlay units. */
export const OverlayLayer = memo(function OverlayLayer({ overlay, lines, pendingLine, compact }: Props) {
  const thin = compact ? 6 : 2.5;
  const { horizon } = overlay;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox={`0 0 ${OVERLAY_WIDTH} ${overlay.height}`}
      preserveAspectRatio="none"
      pointerEvents="none">
      <Line
        x1={horizon.x1}
        y1={horizon.y1}
        x2={horizon.x2}
        y2={horizon.y2}
        stroke="#00E5FF"
        strokeWidth={compact ? 8 : 4}
        strokeOpacity={0.95}
      />
      {overlay.stars.map((star) => {
        const hasSelection = star.selectedLine !== null;
        return (
          <G key={star.id}>
            {Array.from({ length: FAN_LINE_COUNT }, (_, i) => {
              const end = fanEnd(star, star.angle, i);
              const selected = star.selectedLine === i;
              return (
                <Line
                  key={i}
                  x1={star.x}
                  y1={star.y}
                  x2={end.x}
                  y2={end.y}
                  stroke={star.color}
                  strokeWidth={selected ? thin * 3 : thin}
                  strokeOpacity={hasSelection && !selected ? 0.22 : 0.9}
                />
              );
            })}
            <Polygon
              points={starPolygon(star.x, star.y, 26, 11)}
              fill={star.color}
              stroke="#FFFFFF"
              strokeWidth={3}
            />
            {!compact && (
              <SvgText
                x={star.x + 30}
                y={star.y - 22}
                fill="#FFFFFF"
                stroke="#000000"
                strokeWidth={0.8}
                fontSize={30}
                fontWeight="bold"
                fontFamily={Fonts.mono}>
                {star.label}
              </SvgText>
            )}
          </G>
        );
      })}
      {lines?.map((line) => <DrawnLineView key={line.id} line={line} />)}
      {pendingLine && <DrawnLineView line={pendingLine} />}
    </Svg>
  );
});
