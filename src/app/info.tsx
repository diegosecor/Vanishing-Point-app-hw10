import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PerspectiveDiagram, type DiagramKind } from '@/components/perspective-diagram';
import { ScreenHeader } from '@/components/ui';
import { BLUE, Fonts, HAIRLINE, INK, MUTED, STAR_COLORS, WHITE } from '@/constants/style';

type Topic = {
  key: DiagramKind | 'tips';
  tab: string;
  title: string;
  summary: string;
  seeIt: string[];
  inApp: string[];
};

const TOPICS: Topic[] = [
  {
    key: 'one',
    tab: '1 POINT',
    title: 'One-point perspective',
    summary:
      'You look straight at a wall, down a hallway or along a street. Every line that goes away from you meets at ONE point on the horizon. Lines across and up-and-down stay straight and parallel.',
    seeIt: ['A long corridor or train track', 'A room seen from the middle of one wall', 'A road going straight ahead'],
    inApp: [
      'Choose 1 POINT in the camera menu',
      'Tap the horizon where the depth lines meet to place VP1',
      'Tap the fan lines that follow edges in the photo',
    ],
  },
  {
    key: 'two',
    tab: '2 POINTS',
    title: 'Two-point perspective',
    summary:
      'You look at the CORNER of a building or a box. Each side runs to its own point, one left and one right, both on the horizon. Vertical lines stay vertical.',
    seeIt: ['A building seen from a street corner', 'A table or box seen from its corner', 'The corner of a room'],
    inApp: [
      'Choose 2 POINTS',
      'Follow a roof line and a window line on the left side: where they meet is VP1',
      'Do the same on the right side for VP2. The points are often far outside the photo',
    ],
  },
  {
    key: 'three',
    tab: '3 POINTS',
    title: 'Three-point perspective',
    summary:
      'You look UP at a tall building or DOWN from a height. Besides the two points on the horizon, the vertical edges also meet, at a third point above or below.',
    seeIt: ['A skyscraper from the sidewalk', 'A street seen from a rooftop', 'Any photo taken with the phone tilted'],
    inApp: [
      'Choose 3 POINTS',
      'Place VP1 and VP2 on the horizon, then VP3 where the verticals meet',
      'In the editor, the Vertical tool draws lines toward VP3',
    ],
  },
  {
    key: 'fisheye',
    tab: 'FISHEYE',
    title: 'Fisheye (curvilinear) perspective',
    summary:
      'A very wide lens (like the 0.5× camera) bends straight lines into curves. Lines that are parallel in real life become ARCS that meet at two points, one on each side.',
    seeIt: ['Photos taken with the 0.5× lens', 'Door peepholes and action cameras', 'Panoramas and street-art murals'],
    inApp: [
      'In the editor tap ADJUST, then + Fisheye: this adds FE1 and FE2',
      'Move FE1 and FE2 to where the curved lines meet',
      'Choose the Arc tool and tap the photo: every arc goes through FE1 and FE2',
    ],
  },
  {
    key: 'tips',
    tab: 'TIPS',
    title: 'Things to keep in mind',
    summary: 'A few habits that make the vanishing points land in the right place.',
    seeIt: [],
    inApp: [],
  },
];

const TIPS: { title: string; text: string }[] = [
  {
    title: 'The horizon is your eye level',
    text: 'It is not where the sky meets the ground: it is the height of your eyes. Crouch and it goes down, climb stairs and it goes up. In the 2-point diagram, drag a point up or down to see it.',
  },
  {
    title: 'Level the phone first',
    text: 'Watch the level bar at the top (or on the side in landscape). It turns green and vibrates when the phone is level, so the horizon is not tilted.',
  },
  {
    title: 'Follow two real edges',
    text: 'A vanishing point is where two parallel edges meet: a roof line and a window line, two sides of a road. Find two, extend them, and put the point where they cross.',
  },
  {
    title: 'Points outside the photo are normal',
    text: 'In 2-point views the points are often far to the sides. In the editor, tap ALL to zoom out, then select a point and use MOVE POINT, Closer or Farther.',
  },
  {
    title: 'Tilting the phone makes a third point',
    text: 'If you point the phone up or down, vertical edges stop being parallel. Use 3 POINTS and place VP3 where they meet.',
  },
  {
    title: 'Pick the right lens',
    text: 'Use 1× for the most accurate lines. 0.5× fits a whole room but bends edges near the borders; use Fisheye arcs for those photos. 2× is good for far buildings.',
  },
];

export default function InfoScreen() {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const topic = TOPICS[index];

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="LEARN"
        backLabel="← Back"
        onCamera={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {TOPICS.map((t, i) => {
          const on = i === index;
          return (
            <Pressable
              key={t.key}
              onPress={() => setIndex(i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.tab}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}>
        <Text style={styles.title}>{topic.title}</Text>
        <Text style={styles.summary}>{topic.summary}</Text>

        {topic.key !== 'tips' ? (
          <>
            <PerspectiveDiagram key={topic.key} kind={topic.key} />
            <Text style={styles.caption}>IT MOVES ON ITS OWN · TOUCH IT AND DRAG THE COLORED POINTS</Text>

            <Text style={styles.section}>WHERE YOU SEE IT</Text>
            {topic.seeIt.map((line) => (
              <View key={line} style={styles.bulletRow}>
                <View style={[styles.dot, { backgroundColor: STAR_COLORS.VP1 }]} />
                <Text style={styles.bullet}>{line}</Text>
              </View>
            ))}

            <Text style={styles.section}>IN THIS APP</Text>
            {topic.inApp.map((line, i) => (
              <View key={line} style={styles.bulletRow}>
                <View style={styles.step}>
                  <Text style={styles.stepText}>{i + 1}</Text>
                </View>
                <Text style={styles.bullet}>{line}</Text>
              </View>
            ))}
          </>
        ) : (
          TIPS.map((tip, i) => (
            <View key={tip.title} style={styles.tipCard}>
              <View style={[styles.tipNumber, { backgroundColor: i % 2 ? STAR_COLORS.VP2 : STAR_COLORS.VP1 }]}>
                <Text style={styles.tipNumberText}>{i + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipText}>{tip.text}</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: WHITE },
  tabs: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  tab: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: BLUE,
    justifyContent: 'center',
  },
  tabOn: { backgroundColor: BLUE },
  tabText: { fontFamily: Fonts.mono, fontSize: 12, fontWeight: '700', color: BLUE, letterSpacing: 1 },
  tabTextOn: { color: WHITE },
  content: { paddingHorizontal: 18, paddingTop: 4 },
  title: { fontFamily: Fonts.sans, fontSize: 24, fontWeight: '700', color: INK },
  summary: { fontFamily: Fonts.sans, fontSize: 16, color: INK, lineHeight: 23, marginTop: 8, marginBottom: 14 },
  caption: { fontFamily: Fonts.mono, fontSize: 10, color: MUTED, letterSpacing: 0.5, marginTop: 6 },
  section: {
    fontFamily: Fonts.mono,
    fontSize: 11,
    color: BLUE,
    letterSpacing: 1.5,
    fontWeight: '700',
    marginTop: 22,
    marginBottom: 8,
    textDecorationLine: 'underline',
  },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  bullet: { flex: 1, fontFamily: Fonts.sans, fontSize: 15, color: INK, lineHeight: 21 },
  step: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: BLUE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '700', color: BLUE },
  tipCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: HAIRLINE,
    marginBottom: 10,
  },
  tipNumber: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  tipNumberText: { fontFamily: Fonts.mono, fontSize: 13, fontWeight: '700', color: WHITE },
  tipTitle: { fontFamily: Fonts.sans, fontSize: 16, fontWeight: '700', color: INK },
  tipText: { fontFamily: Fonts.sans, fontSize: 14, color: INK, lineHeight: 20, marginTop: 4 },
});
