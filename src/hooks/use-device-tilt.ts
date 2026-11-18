import * as Haptics from 'expo-haptics';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { useEffect, useRef, useState } from 'react';

import { blendRotation, eulerToMatrix, nextUiRotation, type Mat3, type UiRotation } from '@/lib/projection';

export type Tilt = {
  /** Device → world rotation (world z = up, x/y fixed to the compass). */
  R: Mat3;
  /** Sideways tilt for portrait use, radians (0 = level). Also the on-screen angle of the horizon. */
  roll: number;
  /** Sideways tilt for landscape use, radians (0 = level). */
  landscapeRoll: number;
};

export type TiltState = {
  tilt: Tilt;
  status: 'starting' | 'ok' | 'unavailable' | 'denied';
  portraitLevel: boolean;
  landscapeLevel: boolean;
  uiRotation: UiRotation;
};

/** Upright portrait, facing the arbitrary world direction -y. */
const UPRIGHT: Mat3 = eulerToMatrix(0, Math.PI / 2, 0);
const SMOOTHING = 0.3;
const LEVEL_ENTER = (1.0 * Math.PI) / 180;
const LEVEL_EXIT = (1.6 * Math.PI) / 180;

/** Angles are radians on native; guard in case a platform reports degrees. */
export function rotationFrom(data: DeviceMotionMeasurement): Mat3 | null {
  const rot = data.rotation;
  if (!rot) return null;
  const big = Math.abs(rot.alpha) > 7 || Math.abs(rot.beta) > 7 || Math.abs(rot.gamma) > 7;
  const k = big ? Math.PI / 180 : 1;
  return eulerToMatrix(rot.alpha * k, rot.beta * k, rot.gamma * k);
}

function hysteresis(prev: boolean, dev: number) {
  const a = Math.abs(dev);
  if (!prev && a < LEVEL_ENTER) return true;
  if (prev && a > LEVEL_EXIT) return false;
  return prev;
}

/** Reads the phone's attitude for the live camera: horizon, vanishing points, levels and UI rotation. */
export function useDeviceTilt(enabled: boolean): TiltState {
  const [state, setState] = useState<TiltState>({
    tilt: { R: UPRIGHT, roll: 0, landscapeRoll: Math.PI / 2 },
    status: 'starting',
    portraitLevel: false,
    landscapeLevel: false,
    uiRotation: 0,
  });
  const smooth = useRef<Mat3 | null>(null);
  const memory = useRef({ portrait: false, landscape: false, ui: 0 as UiRotation });

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
          const raw = rotationFrom(data);
          if (!raw) return;
          const R = smooth.current ? blendRotation(smooth.current, raw, SMOOTHING) : raw;
          smooth.current = R;

          // World "up" in device coordinates is the third row of R.
          const ux = R[6];
          const uy = R[7];
          const uz = R[8];
          const roll = Math.atan2(ux, uy);
          const landscapeRoll = roll >= 0 ? roll - Math.PI / 2 : roll + Math.PI / 2;

          const mem = memory.current;
          const ui = nextUiRotation(mem.ui, ux, uy, uz);
          const portrait = hysteresis(mem.portrait, roll);
          const landscape = hysteresis(mem.landscape, landscapeRoll);
          const becameLevel = ui === 0 ? portrait && !mem.portrait : landscape && !mem.landscape;
          if (becameLevel) {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }
          memory.current = { portrait, landscape, ui };

          setState({
            tilt: { R, roll, landscapeRoll },
            status: 'ok',
            portraitLevel: portrait,
            landscapeLevel: landscape,
            uiRotation: ui,
          });
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
