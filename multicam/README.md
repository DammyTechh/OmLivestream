# OmliveStream MultiCam

A multi-camera mixer for churches, events and organisations. Take several
cameras, a screen share and your slides, mix them into one professional
picture, and send that to a projector and to every platform at once.

Built with **Tauri** — Rust for the native work, a web UI for the mixer.

---

## Why Tauri, not Electron

This ships to venues, and a venue's AV computer is whatever was already there.

| | Tauri | Electron |
|---|---|---|
| Installer | ~10 MB | ~150 MB |
| Idle memory | ~80 MB | ~350 MB |
| Renderer | OS webview | Bundled Chromium |

On a ten-year-old laptop driving a projector, that difference is the product
working or not.

---

## What it does today

- **Unlimited camera inputs** — USB, built-in, capture cards (anything the OS
  exposes as a camera, so an HDMI capture dongle carrying a PTZ camera or a
  mixer's programme output works)
- **Screen sharing** — slides, lyrics, a browser
- **Six layouts** — single, picture-in-picture, side by side, stacked, three-up, quad
- **Live switching** — change layout and reassign sources mid-broadcast
- **Lower thirds** — speaker names and titles
- **Direct RTMP output** — to OmliveStream, or straight to YouTube/Facebook
- **1080p / 720p / 480p** at 30fps, CBR, tuned for live

### Audio and mixing desks

Audio comes from whatever the OS is using as its input device. Plug a mixing
desk in over USB (Behringer, Yamaha, Focusrite and similar are all class-
compliant, so no drivers), select it as the system input, and the desk's mix is
your broadcast audio. That is the normal setup in a church and it needs nothing
special from us.

### Big screens

Run the programme window on your second display and put it fullscreen. The
projector sees the mixed picture, the operator keeps the controls on the laptop
screen.

---

## Install

### Users

Download the installer, run it, allow camera access when asked.

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 | `.exe` (NSIS) | Installs for all users |
| macOS 13+ | `.dmg` | Apple silicon and Intel |
| Linux | `.AppImage` / `.deb` | |

⚠️ **Until the installers are signed**, Windows shows SmartScreen ("More info →
Run anyway") and macOS shows "unidentified developer" (right-click → Open).
Signing certificates remove both — see below.

### Developers

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Platform prerequisites
#   Windows  Visual Studio Build Tools + WebView2
#   macOS    xcode-select --install
#   Linux    libwebkit2gtk-4.1-dev build-essential curl wget file \
#            libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev

npm install
npm run desktop          # dev
npm run desktop:build    # installers, into src-tauri/target/release/bundle
```

**Before packaging**, drop static ffmpeg builds into `src-tauri/bin/`
(`ffmpeg` and/or `ffmpeg.exe`). Bundling rather than requiring an install is
deliberate: most church and school machines are locked down, and asking a
volunteer to install a command-line tool on Sunday morning is how a product
goes unused.

---

## Roadmap: the virtual camera

Today MultiCam sends its mix **straight out over RTMP**. That covers streaming
and big screens completely.

A *virtual camera* — MultiCam appearing in Zoom, Teams and Meet as though it
were a webcam — is a separate and considerably harder piece of work, and it is
worth being straight about why it is phase 2 rather than shipped.

**macOS** requires a **CMIO Camera Extension**. Apple deprecated the old DAL
plug-in in macOS 12.3 and removed it in 13, so the modern path is a Swift
system extension bundled inside the app. It needs Apple Developer Program
membership, correct entitlements, notarisation, installation from
`/Applications`, and explicit user approval in System Settings. Signing
mistakes surface as a single opaque error (`OSSystemExtensionErrorDomain error
8`).

**Windows** requires either a DirectShow filter (registered COM object, needs a
signed driver package) or the Media Foundation Virtual Camera on Windows 11.

That is weeks of native work per platform plus certificates, which is why the
architecture is arranged so it can be added without disturbing anything: the
entitlement is already declared in `entitlements.plist` (adding it later
invalidates the signing identity and forces a reinstall for every user), and
the mixer already produces exactly the frame stream an extension would consume
— `Mixer.frameBytes()` feeds ffmpeg today and would feed the extension's sink
stream unchanged.

### Suggested order

1. **Now** — RTMP out. Streaming and projection work.
2. **Next** — audio device selection in-app, so the desk can be chosen without
   changing the OS default.
3. **Then** — macOS Camera Extension (the larger market for Zoom-style use).
4. **Later** — Windows virtual camera.

---

## Architecture

```
┌──────────────── Web layer (React) ────────────────┐
│  getUserMedia / getDisplayMedia                   │
│              ↓                                    │
│  Mixer  →  one <canvas>  →  frameBytes()          │
└────────────────────┬──────────────────────────────┘
                     │  Tauri IPC
┌────────────────────┴──────────────────────────────┐
│  Rust: spawn ffmpeg, pipe RGBA on stdin,          │
│        encode H.264/AAC, push RTMP                │
│        (later: hand frames to camera extension)   │
└───────────────────────────────────────────────────┘
```

The web layer does the mixing because layouts, overlays and transitions are the
part that changes often, and the browser's media stack decodes cameras on the
GPU already. Rust does what a browser cannot: real device names, process
control, and system extensions.

### Encoder settings, and why

- `-preset veryfast` — the quality/latency trade every platform recommends.
  Slower presets buy detail no viewer sees and cost frames on a modest CPU.
- `-g` at 2× fps — keyframe every 2s. Platforms want ≤4s, and shorter means
  late joiners see a picture sooner.
- CBR via `-maxrate`/`-bufsize` — RTMP ingest expects a steady rate; VBR is
  what produces buffering people blame on their own internet.
- `-pix_fmt yuv420p` — the only chroma format every platform decodes.
- Silent AAC track — several platforms reject a stream with no audio track at
  all, even when the video is perfect.
