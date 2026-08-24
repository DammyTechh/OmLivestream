import type { ExpoConfig } from 'expo/config';

/**
 * Expo config for the OmliveStream app — Expo SDK 54.
 *
 * SDK 54 is pinned deliberately: it is the version the Expo Go app on the
 * store ships, and this project is meant to be scannable onto a phone without
 * a native build. Bumping the SDK past whatever Expo Go supports produces
 * "Project is incompatible with this version of Expo Go" and nothing else.
 *
 * Two things changed from the SDK 52 version of this file:
 *
 *  1. `newArchEnabled` is gone. The New Architecture is the only architecture
 *     in SDK 54; the flag is a no-op and expo-doctor warns on it.
 *
 *  2. Splash art moved out of the top-level `splash` / `ios.splash` /
 *     `android.splash` keys and into the `expo-splash-screen` config plugin.
 *     Those keys are ignored in SDK 54 — the splash would have silently
 *     rendered as a blank colour, which is exactly the kind of failure nobody
 *     thinks to check for because nothing errors.
 *
 * Everything stays declarative so `ios/` and `android/` remain disposable
 * output of `expo prebuild` rather than hand-edited state to preserve.
 */

const IS_DEV = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: IS_DEV ? 'OmliveStream (Dev)' : 'OmliveStream',
  slug: 'omlivestream',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'omlivestream',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',

  ios: {
    supportsTablet: true,
    bundleIdentifier: IS_DEV ? 'com.omlivestream.app.dev' : 'com.omlivestream.app',
    // The app is a broadcast tool: it must keep capturing and uploading while
    // the creator switches away to read comments in another app.
    infoPlist: {
      UIBackgroundModes: ['audio', 'voip'],
      // Streaming is HTTPS-only; no cleartext exceptions.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
    },
  },

  android: {
    package: IS_DEV ? 'com.omlivestream.app.dev' : 'com.omlivestream.app',
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#0A0818',
    },
    // FOREGROUND_SERVICE_MEDIA_PROJECTION is what makes screen capture legal
    // on Android 14+; declaring it now means the screen-share feature does not
    // need a new permission prompt at review time.
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.MODIFY_AUDIO_SETTINGS',
      'android.permission.INTERNET',
      'android.permission.ACCESS_NETWORK_STATE',
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_CAMERA',
      'android.permission.FOREGROUND_SERVICE_MICROPHONE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
      'android.permission.WAKE_LOCK',
    ],
  },

  plugins: [
    /**
     * The splash follows the system appearance.
     *
     * A fixed dark splash on a phone set to light mode flashes a black
     * rectangle before the app paints — brief, but it happens on every launch
     * and is exactly the seam that makes an app feel unfinished. Declaring
     * both variants lets the OS pick before a line of JavaScript runs.
     *
     * The still is the landing page's hero artwork with the mark at rest — the
     * first frame of AnimatedSplash — so the OS splash and our animated one
     * read as a single moment rather than two screens.
     *
     * `cover`, not `contain`: the artwork is full-bleed, and contain would
     * band the edges with flat colour on any aspect ratio but the source's.
     */
    [
      'expo-splash-screen',
      {
        image: './assets/splash-light.png',
        resizeMode: 'cover',
        backgroundColor: '#F6F4FA',
        dark: {
          image: './assets/splash.png',
          resizeMode: 'cover',
          backgroundColor: '#0A0818',
        },
      },
    ],

    [
      'expo-secure-store',
      {
        faceIDPermission: 'Allow OmliveStream to unlock your saved sign-in.',
      },
    ],

    'expo-web-browser',

    [
      'expo-image-picker',
      {
        photosPermission:
          'OmliveStream needs access to your photos so you can set a profile picture or stream over an image.',
      },
    ],
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#6D28D9',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission:
          'OmliveStream uses your camera so you can broadcast live to your platforms.',
        microphonePermission:
          'OmliveStream uses your microphone so your audience can hear you while you stream.',
        recordAudioAndroid: true,
      },
    ],

    [
      'expo-build-properties',
      {
        android: {
          // Matches SDK 54's own defaults (Android 16 / API 36). Stated
          // explicitly so a future SDK bump does not move them silently.
          minSdkVersion: 24,
          compileSdkVersion: 36,
          targetSdkVersion: 36,
        },
        // No iOS overrides. `useFrameworks: 'static'` used to be set here for
        // react-native-webrtc, but that package is not installed and static
        // frameworks break several Expo modules' Swift interop when nothing
        // actually needs them. Reinstate it in the same commit that adds
        // react-native-webrtc, not before.
      },
    ],

    // 'expo-dev-client' is intentionally absent.
    //
    // Every native module the app currently imports — expo-camera,
    // expo-secure-store, expo-blur, reanimated, gesture-handler, svg — ships
    // inside Expo Go, so the whole app can be scanned onto a real iPhone and a
    // real Android in seconds, from Windows, with no Xcode and no build queue.
    //
    // Add it back (and add react-native-webrtc + mediasoup-client) in the
    // commit that wires up mediasoup publishing. That ships native code, and
    // Expo Go can only run modules baked into it.
  ],

  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.omlivestream.com/api/v1',
    socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? 'https://api.omlivestream.com',
    siteUrl: process.env.EXPO_PUBLIC_SITE_URL ?? 'https://www.omlivestream.com',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
};

export default config;
