import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';

import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { RootNavigator } from '@/navigation';
import { AnimatedSplash } from '@/components/AnimatedSplash';
import { useAuth } from '@/store/auth';

/**
 * App root.
 *
 * The splash screen is held until the stored session has been read and
 * validated. Without that hold the app flashes the sign-in screen for a beat
 * before swapping to the dashboard — a small thing that makes an app feel
 * unfinished every single launch.
 */
void SplashScreen.preventAutoHideAsync().catch(() => { /* already hidden */ });

function Shell() {
  const { t, isDark } = useTheme();
  const hydrate = useAuth((s) => s.hydrate);
  const [ready, setReady] = useState(false);
  const [splashMounted, setSplashMounted] = useState(true);

  useEffect(() => {
    (async () => {
      // Match the window background to the theme so rotation and keyboard
      // transitions never reveal a white strip behind the app.
      await SystemUI.setBackgroundColorAsync(t.bg).catch(() => {});

      // The native splash is hidden immediately, because our animated one is
      // already mounted underneath showing the same composition. Waiting until
      // after hydration would mean staring at a still frame while the work
      // happens, which is the thing the animation exists to avoid.
      await SplashScreen.hideAsync().catch(() => {});

      await hydrate();

      // A floor on how briefly the splash can appear. On a fast device with a
      // warm cache hydration finishes in ~80ms, and a splash that flashes for
      // one frame looks like a glitch rather than an introduction. One breath
      // is the minimum that reads as intentional.
      await new Promise((r) => setTimeout(r, 900));
      setReady(true);
    })();
    // Intentionally once, at launch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={isDark ? 'light' : 'dark'} />

      {/* Mounted underneath the splash so it is fully laid out and painted by
          the time the splash fades — no blank frame in between. */}
      {ready && <RootNavigator />}

      {splashMounted && (
        <AnimatedSplash visible={!ready} onFinished={() => setSplashMounted(false)} />
      )}
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Shell />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
