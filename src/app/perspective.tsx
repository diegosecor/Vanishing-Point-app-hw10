import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RotatedScreen } from '@/components/rotating';
import { ScreenHeader, goToCamera } from '@/components/ui';
import { BLUE, Fonts, HAIRLINE, INK, MUTED, WHITE } from '@/constants/style';
import type { Perspective } from '@/lib/types';
import { useUiRotation } from '@/hooks/use-ui-rotation';
import { useAppStore } from '@/store/app-store';

const OPTIONS: { value: Perspective; title: string; text: string }[] = [
  {
    value: 1,
    title: '1 point',
    text: 'You face a flat wall or look straight down a street or hallway. All depth lines meet at one point on the horizon.',
  },
  {
    value: 2,
    title: '2 points',
    text: 'You look at the corner of a building or room. Each side runs to its own point on the horizon, left and right. Verticals stay parallel.',
  },
  {
    value: 3,
    title: '3 points',
    text: 'You look up at a tall building or down from a height. Two points on the horizon, plus a third above or below where the verticals converge. Place VP3 anywhere.',
  },
];

export default function PerspectiveScreen() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useAppStore();
  const rotation = useUiRotation();

  return (
    <RotatedScreen rotation={rotation}>
      <View style={styles.root}>
        <ScreenHeader title="PERSPECTIVE" />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <Text style={styles.intro}>
            How many vanishing points? This sets how many points you can place.
          </Text>
          {OPTIONS.map((opt) => {
            const selected = settings.perspective === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => {
                  updateSettings({ perspective: opt.value });
                  goToCamera();
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.option,
                  selected && styles.optionSelected,
                  { opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <View style={styles.optionHead}>
                  <Text style={[styles.optionTitle, selected && styles.optionTitleSelected]}>
                    {opt.title}
                  </Text>
                  <Text style={styles.optionMark}>{selected ? '[■]' : '[ ]'}</Text>
                </View>
                <Text style={styles.optionText}>{opt.text}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </RotatedScreen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },
  content: { padding: 20, gap: 14 },
  intro: { fontFamily: Fonts.mono, fontSize: 12, color: MUTED, lineHeight: 18, marginBottom: 4 },
  option: { borderWidth: 1, borderColor: HAIRLINE, borderRadius: 10, padding: 16 },
  optionSelected: { borderColor: BLUE, borderWidth: 1.5 },
  optionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optionTitle: { fontFamily: Fonts.sans, fontSize: 20, fontWeight: '600', color: INK },
  optionTitleSelected: { color: BLUE, textDecorationLine: 'underline' },
  optionMark: { fontFamily: Fonts.mono, fontSize: 14, color: BLUE },
  optionText: { fontFamily: Fonts.sans, fontSize: 15, color: '#3A3F47', marginTop: 8, lineHeight: 21 },
});
