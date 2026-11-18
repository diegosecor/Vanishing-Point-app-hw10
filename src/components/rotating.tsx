import { useEffect, useState } from 'react';
import {
  Animated,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import type { UiRotation } from '@/lib/projection';

/** Spins its content to stay upright (animated), without moving it — like the iOS Camera buttons. */
export function RotatingView({
  rotation,
  style,
  children,
}: {
  rotation: UiRotation | number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const [anim] = useState(() => new Animated.Value(rotation));

  useEffect(() => {
    Animated.timing(anim, { toValue: rotation, duration: 220, useNativeDriver: true }).start();
  }, [anim, rotation]);

  const rotate = anim.interpolate({ inputRange: [-180, 180], outputRange: ['-180deg', '180deg'] });
  return <Animated.View style={[style, { transform: [{ rotate }] }]}>{children}</Animated.View>;
}

/**
 * Lays a whole screen out sideways when the phone is held in landscape, so a
 * menu reads horizontally even though the app itself is locked to portrait.
 */
export function RotatedScreen({ rotation, children }: { rotation: UiRotation; children: React.ReactNode }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const sideways = rotation !== 0 && size.w > 0;

  return (
    <View style={styles.fill} onLayout={onLayout}>
      <View
        style={
          sideways
            ? {
                position: 'absolute',
                width: size.h,
                height: size.w,
                left: (size.w - size.h) / 2,
                top: (size.h - size.w) / 2,
                transform: [{ rotate: `${rotation}deg` }],
              }
            : styles.fill
        }
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
