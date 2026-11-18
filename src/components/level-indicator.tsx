import { StyleSheet, Text, View } from 'react-native';

import { Fonts, LEVEL_OFF, LEVEL_OK } from '@/constants/style';

/**
 * On-screen level. The moving bar always follows the real horizon; the box
 * turns green when level. `rotation` (deg) turns the whole box, e.g. 90 for
 * the side level used when the phone is held in landscape.
 */
export function LevelIndicator({
  deviation,
  horizonAngle,
  isLevel,
  active,
  rotation = 0,
}: {
  /** Tilt away from level, radians. */
  deviation: number;
  /** On-screen angle of the horizon, radians. */
  horizonAngle: number;
  isLevel: boolean;
  active: boolean;
  rotation?: number;
}) {
  const color = !active ? '#9AA0A6' : isLevel ? LEVEL_OK : LEVEL_OFF;
  const degrees = (deviation * 180) / Math.PI;
  const barAngle = horizonAngle - (rotation * Math.PI) / 180;
  return (
    <View
      style={[styles.box, { borderColor: color, transform: [{ rotate: `${rotation}deg` }] }]}
      accessibilityLabel={`Level ${degrees.toFixed(1)} degrees`}
    >
      <View style={styles.track}>
        <View style={styles.reference} />
        <View style={[styles.bar, { backgroundColor: color, transform: [{ rotate: `${barAngle}rad` }] }]} />
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
      <Text style={[styles.text, { color }]}>
        {active ? (isLevel ? 'LEVEL' : `${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}°`) : 'NO SENSOR'}
      </Text>
    </View>
  );
}

export const LEVEL_BOX_WIDTH = 176;

const styles = StyleSheet.create({
  box: {
    width: LEVEL_BOX_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  track: { width: 70, height: 24, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  reference: { position: 'absolute', width: 70, height: 1, backgroundColor: 'rgba(255,255,255,0.6)' },
  bar: { position: 'absolute', width: 58, height: 3, borderRadius: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700', flex: 1, textAlign: 'right' },
});
