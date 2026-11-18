import { router } from 'expo-router';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BLUE, Fonts, HAIRLINE, INK, WHITE } from '@/constants/style';

/** Underlined blue text button, the app's main "menu" element. */
export function LinkButton({
  label,
  onPress,
  disabled,
  color = BLUE,
  style,
  textStyle,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [styles.link, { opacity: disabled ? 0.35 : pressed ? 0.5 : 1 }, style]}
    >
      <Text style={[styles.linkText, { color }, textStyle]}>{label}</Text>
    </Pressable>
  );
}

export function goToCamera() {
  if (router.canDismiss()) router.dismissAll();
  else router.replace('/');
}

/** White top bar with a button back to the camera, used on every secondary screen. */
export function ScreenHeader({
  title,
  right,
  onCamera = goToCamera,
}: {
  title: string;
  right?: React.ReactNode;
  onCamera?: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <LinkButton label="← Camera" onPress={onCamera} style={styles.headerSide} />
      <Text style={styles.title}>{title}</Text>
      <View style={[styles.headerSide, styles.headerRight]}>{right}</View>
    </View>
  );
}

export const textStyles = StyleSheet.create({
  body: { fontFamily: Fonts.sans, fontSize: 15, color: INK },
  mono: { fontFamily: Fonts.mono, fontSize: 12, color: INK, letterSpacing: 0.5 },
});

const styles = StyleSheet.create({
  link: { paddingVertical: 4 },
  linkText: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  header: {
    backgroundColor: WHITE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: HAIRLINE,
  },
  headerSide: { width: 96 },
  headerRight: { alignItems: 'flex-end' },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.mono,
    fontSize: 14,
    letterSpacing: 2,
    color: INK,
  },
});
