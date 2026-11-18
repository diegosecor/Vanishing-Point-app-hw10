import { DeviceMotion } from 'expo-sensors';
import { useEffect, useState } from 'react';

import { nextUiRotation, type UiRotation } from '@/lib/projection';

import { rotationFrom } from './use-device-tilt';

/**
 * The app is locked to portrait; this tells screens how to rotate their text
 * so it reads upright when the phone is held sideways (like the iOS Camera app).
 */
export function useUiRotation(enabled = true): UiRotation {
  const [rotation, setRotation] = useState<UiRotation>(0);

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;
    let current: UiRotation = 0;
    (async () => {
      try {
        if (!(await DeviceMotion.isAvailableAsync())) return;
        const perm = await DeviceMotion.getPermissionsAsync();
        if (!perm.granted || cancelled) return;
        sub = DeviceMotion.addListener((data) => {
          const R = rotationFrom(data);
          if (!R) return;
          const next = nextUiRotation(current, R[6], R[7], R[8]);
          if (next !== current) {
            current = next;
            setRotation(next);
          }
        });
      } catch {
        // No sensor: stay in portrait.
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return rotation;
}
