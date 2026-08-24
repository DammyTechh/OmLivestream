# OmliveStream — Mobile

iOS and Android app for OmliveStream, built with **React Native (Expo) + TypeScript**.

It talks to the same backend the website does, so an account is one account: sign
in on either, and streams, platforms, recordings and billing are the same data.

---

## Why React Native

- **mediasoup officially supports it.** The streaming pipeline is mediasoup, and
  its docs list React Native as a supported target via `react-native-webrtc` +
  `registerGlobals()`. Flutter has no official client — that would mean betting
  the core feature on a community port.
- **Same language as the rest of the product.** Entitlements, API contracts and
  auth logic mirror the web app rather than being reimplemented in another
  language and drifting apart.
- **One person can maintain it.** Native means Swift *and* Kotlin.

---

## Requirements

| | |
|---|---|
| Node | **20.x** (Expo SDK 52; Node 22 breaks the bundler) |
| Xcode | 15+ for iOS |
| Android Studio | Ladybug+ for Android |
| Apple Developer | Required for device testing and for screen sharing |

**This is not an Expo Go app.** `react-native-webrtc` ships native code, so it
needs a dev build. That is deliberate — discovering it later means redoing setup.

```bash
npm install
npx expo prebuild --clean      # generates ios/ and android/
npx expo run:ios               # or: npx expo run:android
```

Environment (`.env`, or your EAS secrets):

```
EXPO_PUBLIC_API_URL=https://api.omlivestream.com/api/v1
EXPO_PUBLIC_SOCKET_URL=https://api.omlivestream.com
EXPO_PUBLIC_SITE_URL=https://www.omlivestream.com
```

---

## Layout

```
src/
  api/          HTTP client, secure token storage
  components/   UI primitives, Screen shell, Icon set, Logo, FeedbackSheet
  constants/    theme tokens, entitlements
  hooks/        theme + responsive layout
  navigation/   root stack, floating tab bar
  screens/      SignIn, Overview, GoLive, Live, Streams, Platforms,
                Recordings, Settings
  store/        auth (zustand)
```

---

## Decisions worth knowing

**Tokens live in the device keychain** (`expo-secure-store`), not AsyncStorage —
which is an unencrypted file readable on a rooted device. Scoped
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so a restored backup requires signing in again.

**A stored token is a claim, not proof.** At launch it is used to fetch the
profile; only a successful fetch counts as signed in. A revoked session surfaces
on the splash screen instead of as failures deep in the app.

**One refresh at a time.** A screen firing several requests produces a burst of
401s together; without single-flight, each starts its own refresh, the first
rotates the token, and the rest fail — signing the user out for no reason.

**OAuth uses the system browser**, never a WebView. Google blocks OAuth in
embedded WebViews outright, and the system session shares cookies with
Safari/Chrome so an already-signed-in user taps once.

**The live screen holds keep-awake** for exactly as long as it is mounted. A
phone locking mid-broadcast is a dropped stream.

**Leaving a live broadcast is guarded.** Android back and the close button both
confirm; swipe-to-dismiss is disabled on that screen.

**Checkout opens on the web.** An in-app payment sheet would put this under the
app stores' in-app purchase rules — a much larger conversation.

---

## Not yet wired

| | |
|---|---|
| **mediasoup publishing** | `react-native-webrtc` and `mediasoup-client` are installed and the Go Live → Live flow is complete against the API. The `Device`/transport/producer wiring is the next piece. |
| **Screen sharing** | iOS needs a **ReplayKit Broadcast Upload Extension** (a Swift target, unavoidable in any framework); Android needs `MediaProjection` + a foreground service. Permissions are already declared in `app.config.ts`. |
| **Push notifications** | Not started. |

The camera preview uses `expo-camera` so the flow is testable end to end today;
swapping it for the WebRTC track is a contained change inside `GoLiveScreen` and
`LiveScreen`.
