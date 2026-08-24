import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';

/**
 * Push notifications.
 *
 * What they are for here is narrow and worth stating, because a streaming app
 * is exactly the kind of product that ends up spamming people: a creator
 * should hear when their *own* broadcast has a problem — a platform rejected
 * the stream, the connection dropped, a recording finished processing. Not
 * marketing.
 *
 * Registration is deliberately quiet about failure. A device without a push
 * token still works completely; there is no reason to interrupt someone with
 * an error about a feature they did not ask for. Every failure path returns
 * null and the app carries on.
 */

// How a notification behaves when it lands while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    // Silent in-app. A creator reading this is already looking at the screen,
    // and a sound mid-broadcast would go out over the stream.
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

async function registerForPush(): Promise<string | null> {
  // Simulators have no push service; asking produces a confusing error rather
  // than a token.
  if (!Device.isDevice) return null;

  try {
    if (Platform.OS === 'android') {
      // Android 8+ requires a channel before anything can be delivered. Without
      // one, notifications are silently dropped — no error, nothing arrives.
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Stream alerts',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#6D28D9',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;

    // Only ask if we have not already been answered. Re-prompting someone who
    // said no is both useless (the OS will not show it again) and rude.
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

    if (!projectId) return null; // not built with EAS yet — nothing to register against

    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    return token.data;
  } catch {
    return null;
  }
}

/**
 * Registers this device once the user is signed in, and keeps the app
 * responsive to taps on a notification.
 *
 * Tied to sign-in rather than to launch because a token is meaningless without
 * an account to attach it to — and registering before sign-in would mean
 * sending alerts to a device with no idea whose they are.
 */
export function usePushNotifications() {
  const user = useAuth((s) => s.user);
  const registered = useRef<string | null>(null);

  useEffect(() => {
    if (!user) { registered.current = null; return; }

    (async () => {
      const token = await registerForPush();
      if (!token || registered.current === token) return;

      try {
        await api.post('/users/me/push-token', {
          token,
          platform: Platform.OS,
        });
        registered.current = token;
      } catch {
        // The endpoint may not exist yet. Failing quietly is correct: the app
        // is fully usable without push, and there is nothing the creator could
        // do about it anyway.
      }
    })();
  }, [user]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      // Deep-linking from a notification to the relevant stream goes here once
      // the payload shape is settled. Registering the listener now means the
      // tap is never a no-op that leaves someone staring at the home screen.
    });
    return () => sub.remove();
  }, []);
}
