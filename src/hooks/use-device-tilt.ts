import * as Haptics from 'expo-haptics';
import { DeviceMotion } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';

export type Tilt = {
  /** World "up" expressed in device coordinates (x right, y toward top of phone). */
  upX: number;
  upY: number;
  /** Elevation of the back camera's view direction, radians (positive = looking up). */
  elevation: number;
  /** Sideways rotation of the phone, radians (0 = perfectly level). */
  roll: number;
};

export type TiltState = {
  tilt: Tilt;
  status: 'starting' | 'ok' | 'unavailable' | 'denied';
  isLevel: boolean;
};

const UPRIGHT: Tilt = { upX: 0, upY: 1, elevation: 0, roll: 0 };
const SMOOTHING = 0.25;
const LEVEL_ENTER = (1.0 * Math.PI) / 180;
const LEVEL_EXIT = (1.6 * Math.PI) / 180;

/**
 * Reads the phone's attitude and returns where the horizon is relative to the
 * camera. Uses the Euler angles (Z-X-Y order, as both iOS and the W3C spec use)
 * to rebuild the gravity direction, which stays stable even when the phone is
 * held upright (where beta/gamma alone hit gimbal lock).
 */
export function useDeviceTilt(enabled: boolean): TiltState {
  const [state, setState] = useState<TiltState>({ tilt: UPRIGHT, status: 'starting', isLevel: false });
  const smooth = useRef({ x: 0, y: 1, z: 0 });
  const levelRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let sub: { remove: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (!available) {
          if (!cancelled) setState((s) => ({ ...s, status: 'unavailable' }));
          return;
        }
        const perm = await DeviceMotion.getPermissionsAsync();
        if (!perm.granted) {
          const req = await DeviceMotion.requestPermissionsAsync();
          if (!req.granted) {
            if (!cancelled) setState((s) => ({ ...s, status: 'denied' }));
            return;
          }
        }
        if (cancelled) return;
        DeviceMotion.setUpdateInterval(33);
        sub = DeviceMotion.addListener((data) => {
          const rot = data.rotation;
          if (!rot) return;
          // Angles are radians on native; guard in case a platform reports degrees.
          const k = Math.abs(rot.beta) > 7 || Math.abs(rot.gamma) > 7 ? Math.PI / 180 : 1;
          const b = rot.beta * k;
          const g = rot.gamma * k;
          // World up vector in device frame = third row of Rx(beta)*Ry(gamma).
          const ux = -Math.cos(b) * Math.sin(g);
          const uy = Math.sin(b);
          const uz = Math.cos(b) * Math.cos(g);

          const sm = smooth.current;
          sm.x += (ux - sm.x) * SMOOTHING;
          sm.y += (uy - sm.y) * SMOOTHING;
          sm.z += (uz - sm.z) * SMOOTHING;
          const len = Math.hypot(sm.x, sm.y, sm.z) || 1;
          const x = sm.x / len;
          const y = sm.y / len;
          const z = sm.z / len;

          // The back camera looks along device -Z.
          const elevation = Math.asin(Math.max(-1, Math.min(1, -z)));
          const roll = Math.atan2(x, y);

          const absRoll = Math.abs(roll);
          let level = levelRef.current;
          if (!level && absRoll < LEVEL_ENTER) level = true;
          else if (level && absRoll > LEVEL_EXIT) level = false;
          if (level && !levelRef.current) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          levelRef.current = level;

          setState({ tilt: { upX: x, upY: y, elevation, roll }, status: 'ok', isLevel: level });
        });
      } catch (e) {
        console.warn('Device motion error', e);
        if (!cancelled) setState((s) => ({ ...s, status: 'unavailable' }));
      }
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [enabled]);

  return state;
}
