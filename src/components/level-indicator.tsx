import { StyleSheet, Text, View } from 'react-native';

import { Fonts, LEVEL_OFF, LEVEL_OK } from '@/constants/style';

/** Small on-screen level: the moving bar follows the real horizon; it turns green when level. */
export function LevelIndicator({ roll, isLevel, active }: { roll: number; isLevel: boolean; active: boolean }) {
  const color = !active ? '#9AA0A6' : isLevel ? LEVEL_OK : LEVEL_OFF;
  const degrees = (roll * 180) / Math.PI;
  return (
    <View style={[styles.box, { borderColor: color }]} accessibilityLabel={`Level ${degrees.toFixed(1)} degrees`}>
      <View style={styles.track}>
        <View style={styles.reference} />
        <View style={[styles.bar, { backgroundColor: color, transform: [{ rotate: `${roll}rad` }] }]} />
        <View style={[styles.dot, { backgroundColor: color }]} />
      </View>
      <Text style={[styles.text, { color }]}>
        {active ? (isLevel ? 'LEVEL' : `${degrees >= 0 ? '+' : ''}${degrees.toFixed(1)}°`) : 'NO SENSOR'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1.5,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  track: { width: 84, height: 24, alignItems: 'center', justifyContent: 'center' },
  reference: {
    position: 'absolute',
    width: 84,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  bar: { position: 'absolute', width: 70, height: 3, borderRadius: 2 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  text: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700', minWidth: 58, textAlign: 'right' },
});
