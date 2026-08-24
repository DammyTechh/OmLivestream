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
| Node | **20.19.4 or newer.** 20, 22, 24 and 25 all work |
| Expo SDK | **54** — matches the Expo Go build on the App Store / Play Store |
| Phone | Expo Go (update it if the app refuses to open the project) |

### Why the SDK version is pinned

Expo Go can only run the SDK it was compiled against. If this project declares
a newer SDK than the Expo Go on the phone, the app refuses to open it:

```
Project is incompatible with this version of Expo Go
```

That is the one error `npm install` cannot fix — it is a phone-side version
mismatch, not a dependency problem. Either keep the project on the SDK that
store Expo Go ships (what this repo does), or move to a development build,
which bakes in whatever SDK you choose and stops the question from existing.

### Node is no longer pinned

The project used to sit on Expo SDK 52, which could not tolerate the TypeScript
type-stripping Node introduced in 22 and turned on by default in 24 — every
command died inside `expo-modules-core` with
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. The old `.npmrc` set
`engine-strict=true` and a `preinstall` hook rejected the install outright, so
at least the failure named itself instead of surfacing as a bundler crash.

SDK 54 handles modern Node directly, so the guard, the hook and the pin are all
gone. `engines` is still declared, but as a warning rather than a wall.

---

## Running it today — Expo Go

The app currently uses **only modules bundled inside Expo Go**, so it runs on a
real iPhone and a real Android in seconds, from any machine — no Xcode, no
Android Studio, no build queue, no Apple Developer account.

```bash
npm install
npm start          # scan the QR with Expo Go (Android) or Camera (iOS)
```

Phone and computer must be on the same wifi. If the venue's network blocks
device-to-device traffic, `npx expo start --tunnel` routes around it.

> **iOS from Windows:** `expo run:ios` will always refuse — Apple requires
> macOS to compile. Expo Go sidesteps that entirely, which is the main reason
> to start here.

`react-native-webrtc` and `mediasoup-client` are **not installed**. They used to
sit in `optionalDependencies`, which npm installs by default — so an unused,
RN-0.76-era native package was being pulled into every install and blocking the
upgrade for no benefit. Nothing imports them yet; add them in the commit that
actually uses them.

---

## Later — dev builds

The moment mediasoup publishing is wired in, Expo Go stops being an option:
that package ships native code, and Expo Go can only run modules baked into it.

At that point:

1. `npx expo install react-native-webrtc mediasoup-client expo-dev-client`
2. Add `'expo-dev-client'` to `plugins` in `app.config.ts`
3. Restore the iOS block in `expo-build-properties` — webrtc needs
   `useFrameworks: 'static'` and a raised `deploymentTarget` to link
   (a dev build also unpins the SDK, since Expo Go is no longer involved)
4. Build:

```bash
npm run start:dev-client

# Local (macOS needed for iOS)
npx expo prebuild --clean
npx expo run:android          # or run:ios

# Or in the cloud — works from Windows, iOS included
npx eas build -p android --profile development
npx eas build -p ios --profile development
```

Screen sharing additionally needs a paid Apple Developer account, since the
ReplayKit extension cannot run in a simulator.

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
| **mediasoup publishing** | The Go Live → Live flow is complete against the API. `react-native-webrtc` + `mediasoup-client` are not installed yet; the `Device`/transport/producer wiring is the next piece. |
| **Screen sharing** | iOS needs a **ReplayKit Broadcast Upload Extension** (a Swift target, unavoidable in any framework); Android needs `MediaProjection` + a foreground service. Permissions are already declared in `app.config.ts`. |
| **Push notifications** | Not started. |

The camera preview uses `expo-camera` so the flow is testable end to end today;
swapping it for the WebRTC track is a contained change inside `GoLiveScreen` and
`LiveScreen`.
