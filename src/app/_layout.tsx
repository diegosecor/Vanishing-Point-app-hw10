import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { WHITE } from '@/constants/style';
import { AppStoreProvider, useAppStore } from '@/store/app-store';

SplashScreen.preventAutoHideAsync().catch(() => {});

function RootStack() {
  const { ready } = useAppStore();

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: WHITE } }}>
      <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: '#000' } }} />
      <Stack.Screen name="gallery" />
      {/* Swipe-back is off so unsaved lines can't be lost without the discard prompt. */}
      <Stack.Screen name="editor" options={{ gestureEnabled: false }} />
      <Stack.Screen name="perspective" options={{ presentation: 'modal' }} />
      <Stack.Screen name="info" options={{ presentation: 'modal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AppStoreProvider>
      <RootStack />
    </AppStoreProvider>
  );
}
