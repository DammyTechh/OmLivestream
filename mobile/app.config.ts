import type { ExpoConfig } from 'expo/config';

/**
 * Expo config for the OmliveStream app.
 *
 * This is a *dev build* app, not an Expo Go app. react-native-webrtc ships
 * native code, and Expo Go can only run the modules baked into it — so the
 * moment the streaming pipeline is real, Expo Go stops being an option. Using
 * `expo prebuild` + `expo run:ios|android` from day one avoids discovering
 * that halfway through.
 *
 * Everything here is declarative on purpose: the native projects are generated
 * from this file, so `ios/` and `android/` stay disposable and there is no
 * hand-edited Xcode state to lose.
 */

const IS_DEV = process.env.APP_VARIANT === 'development';

const config: ExpoConfig = {
  name: IS_DEV ? 'OmliveStream (Dev)' : 'OmliveStream',
  slug: 'omlivestream',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'omlivestream',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  icon: './assets/icon.png',

  /**
   * The splash follows the system appearance.
   *
   * A fixed dark splash on a phone set to light mode flashes a black rectangle
   * before the app paints — brief, but it happens on every single launch and
   * is exactly the kind of seam that makes an app feel unfinished. Declaring
   * both variants lets the OS pick before a line of JavaScript runs.
   *
   * The still is the landing page's hero artwork with the mark at rest — the
   * exact first frame of AnimatedSplash. The OS shows this before any of our
   * code runs, and our animated version mounts on top continuing from it, so
   * the two read as one moment rather than two screens.
   *
   * `cover`, not `contain`: the artwork is full-bleed, and contain would band
   * the edges with flat colour on any aspect ratio but the source's.
   */
  splash: {
    image: './assets/splash.png',
    resizeMode: 'cover',
    backgroundColor: '#0A0818',
    dark: {
      image: './assets/splash.png',
      resizeMode: 'cover',
      backgroundColor: '#0A0818',
    },
  },

  ios: {
    supportsTablet: true,
    // iOS resolves this against the system appearance at launch.
    splash: {
      image: './assets/splash-light.png',
      resizeMode: 'cover',
      backgroundColor: '#F6F4FA',
      dark: {
        image: './assets/splash.png',
        resizeMode: 'cover',
        backgroundColor: '#0A0818',
      },
    },
    bundleIdentifier: IS_DEV ? 'com.omlivestream.app.dev' : 'com.omlivestream.app',
    // The app is a broadcast tool: it must keep capturing and uploading while
    // the creator switches away to read comments on another app.
    infoPlist: {
      NSCameraUsageDescription:
        'OmliveStream uses your camera so you can broadcast live to your platforms.',
      NSMicrophoneUsageDescription:
        'OmliveStream uses your microphone so your audience can hear you while you stream.',
      NSPhotoLibraryUsageDescription:
        'Choose a thumbnail or profile photo for your streams.',
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
    splash: {
      image: './assets/splash-light.png',
      resizeMode: 'cover',
      backgroundColor: '#F6F4FA',
      dark: {
        image: './assets/splash.png',
        resizeMode: 'cover',
        backgroundColor: '#0A0818',
      },
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
    'expo-dev-client',
    'expo-secure-store',
    'expo-web-browser',
    [
      'expo-build-properties',
      {
        ios: {
          // react-native-webrtc needs a modern deployment target and
          // static frameworks to link the WebRTC binary correctly.
          deploymentTarget: '15.1',
          useFrameworks: 'static',
        },
        android: {
          minSdkVersion: 24,
          compileSdkVersion: 35,
          targetSdkVersion: 35,
        },
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
  ],

  extra: {
    // Read through src/constants/env.ts rather than directly, so there is one
    // place that knows what happens when a value is missing.
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'https://api.omlivestream.com/api/v1',
    socketUrl: process.env.EXPO_PUBLIC_SOCKET_URL ?? 'https://api.omlivestream.com',
    siteUrl: process.env.EXPO_PUBLIC_SITE_URL ?? 'https://www.omlivestream.com',
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '' },
  },
};

export default config;
