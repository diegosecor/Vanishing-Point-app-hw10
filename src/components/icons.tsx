import Svg, { Path } from 'react-native-svg';

import { BLUE } from '@/constants/style';

export type IconName = 'up' | 'down' | 'left' | 'right' | 'turn-left' | 'turn-right' | 'undo' | 'vertical' | 'info' | 'brush' | 'arc';

/**
 * Small line icons drawn with SVG. Unicode arrows (◀ ▶ ▲ ▼) are not used because iOS
 * shows some of them as colored emoji and others as text, so they never match.
 */
export function Icon({ name, size = 18, color = BLUE }: { name: IconName; size?: number; color?: string }) {
  const stroke = { stroke: color, strokeWidth: 2.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  let d: string;
  switch (name) {
    case 'up':
      d = 'M5 15 L12 8 L19 15';
      break;
    case 'down':
      d = 'M5 9 L12 16 L19 9';
      break;
    case 'left':
      d = 'M15 5 L8 12 L15 19';
      break;
    case 'right':
      d = 'M9 5 L16 12 L9 19';
      break;
    case 'turn-left':
      d = 'M8 17.5 A7 7 0 1 0 6 9 M9.5 7.1 L6 9 L5.4 5';
      break;
    case 'turn-right':
      d = 'M16 17.5 A7 7 0 1 1 18 9 M14.5 7.1 L18 9 L18.6 5';
      break;
    case 'undo':
      d = 'M9 7 L5 11 L9 15 M5 11 H14 A5 5 0 0 1 14 21 H11';
      break;
    case 'info':
      d = 'M12 3 A9 9 0 1 0 12.01 3 M12 11 V17 M12 7.5 V7.6';
      break;
    case 'brush':
      d = 'M4 20 C6 20 8 18 8 16 C8 14.5 9 13.5 10.5 13.5 L19 5 M10.5 13.5 L12.5 15.5';
      break;
    case 'arc':
      d = 'M3 16 Q12 4 21 16 M3 20 Q12 12 21 20';
      break;
    case 'vertical':
      d = 'M12 3 V21 M8 7 L12 3 L16 7 M8 17 L12 21 L16 17';
      break;
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={d} {...stroke} />
    </Svg>
  );
}
