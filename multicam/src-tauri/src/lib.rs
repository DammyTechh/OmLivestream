// OmliveStream MultiCam — native backend.
//
// The split of responsibility is deliberate:
//
//   • The web layer does the *mixing*. Cameras arrive as MediaStreams via
//     getUserMedia, get composited onto a canvas, and leave as a single
//     captureStream. That is the part that benefits from being easy to change
//     — layouts, transitions, overlays — and the browser's media stack is
//     genuinely excellent at it.
//
//   • Rust does the things a browser cannot: enumerating real devices with
//     their true names, spawning ffmpeg to push RTMP, watching that process,
//     and (later) handing frames to the virtual camera extension.
//
// Tauri rather than Electron because this ships to churches and event teams on
// whatever hardware they own. A Tauri binary is ~10MB against Electron's
// ~150MB, uses the OS webview instead of bundling Chromium, and idles at a
// fraction of the memory — which matters on the ten-year-old laptop running
// the projector.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use tauri::State;

// ── Types ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MediaDevice {
    pub id: String,
    pub name: String,
    pub kind: String, // "video" | "audio"
}

#[derive(Debug, Deserialize, Clone)]
pub struct Destination {
    /// Human name, for error messages: "Twitch", "Church YouTube".
    pub label: String,
    pub rtmp_url: String,
    pub stream_key: String,
}

#[derive(Debug, Deserialize)]
pub struct OutputConfig {
    /// Every platform this broadcast goes to, at once.
    pub destinations: Vec<Destination>,
    pub width: u32,
    pub height: u32,
    pub fps: u32,
    pub video_bitrate_kbps: u32,
    pub audio_bitrate_kbps: u32,
}

#[derive(Default)]
pub struct AppState {
    ffmpeg: Mutex<Option<Child>>,
}

// ── ffmpeg discovery ────────────────────────────────────────────────

/// Locate ffmpeg, preferring the copy we ship.
///
/// A bundled binary means the product works on a machine where nobody has
/// admin rights to install anything — which describes most church and school
/// AV computers. Falling back to `PATH` lets a technical user point at their
/// own build.
fn ffmpeg_path(app: &tauri::AppHandle) -> String {
    use tauri::Manager;
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };

    if let Ok(dir) = app.path().resource_dir() {
        let bundled = dir.join("bin").join(name);
        if bundled.exists() {
            return bundled.to_string_lossy().into_owned();
        }
    }
    name.to_string()
}

#[tauri::command]
fn check_ffmpeg(app: tauri::AppHandle) -> Result<String, String> {
    let path = ffmpeg_path(&app);
    Command::new(&path)
        .arg("-version")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .map_err(|_| {
            "ffmpeg was not found. Reinstall MultiCam, or install ffmpeg and \
             make sure it is on your PATH."
                .to_string()
        })
        .and_then(|out| {
            String::from_utf8(out.stdout)
                .map_err(|e| e.to_string())
                .map(|s| s.lines().next().unwrap_or("ffmpeg").to_string())
        })
}

// ── Broadcast ───────────────────────────────────────────────────────

/// Start pushing the mixed programme out over RTMP.
///
/// ffmpeg reads raw frames from stdin rather than opening a capture device
/// itself. The web layer has already composited every camera, overlay and
/// layout into one canvas, so handing over finished frames keeps a single
/// source of truth for what the audience sees — the operator's preview and the
/// stream cannot disagree.
///
/// Encoder settings are tuned for live rather than for file size:
///   • `-preset veryfast` — the quality/latency trade every platform recommends.
///     Slower presets buy detail the viewer never sees and cost frames on a
///     modest CPU.
///   • `-g` at 2× fps — a keyframe every two seconds. Every major platform
///     wants ≤4s, and shorter keyframes mean viewers joining mid-stream see a
///     picture sooner.
///   • CBR via `-maxrate`/`-bufsize` — RTMP ingest expects a steady rate, and
///     variable bitrate is what produces the buffering people blame on their
///     own internet.
///   • `-pix_fmt yuv420p` — the only chroma format every platform decodes.
#[tauri::command]
fn start_broadcast(
    app: tauri::AppHandle,
    state: State<AppState>,
    config: OutputConfig,
) -> Result<(), String> {
    let mut guard = state.ffmpeg.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("A broadcast is already running.".into());
    }

    if config.destinations.is_empty() {
        return Err("Add at least one destination before going live.".into());
    }

    /*
     * One encoder, many destinations — via ffmpeg's `tee` muxer.
     *
     * The naive approach is one ffmpeg per platform, which encodes the same
     * frames three or four times over and will saturate the CPU of the laptop
     * running the projector. Encoding once and fanning the finished packets
     * out costs barely more than a single stream.
     *
     * `onfail=ignore` is the part that matters in a live room: without it, one
     * bad stream key takes down every other destination too. With it, a dead
     * platform simply drops out and the rest carry on — nobody in the
     * congregation notices.
     *
     * This mirrors what the OmliveStream server does for phone broadcasts, so
     * a stream mixed here behaves the same way as one sent from the app.
     */
    let tee_targets = config
        .destinations
        .iter()
        .map(|d| {
            format!(
                "[f=flv:onfail=ignore]{}/{}",
                d.rtmp_url.trim_end_matches('/'),
                d.stream_key.trim()
            )
        })
        .collect::<Vec<_>>()
        .join("|");

    let child = Command::new(ffmpeg_path(&app))
        .args([
            "-hide_banner", "-loglevel", "warning",
            // Input: raw RGBA frames on stdin from the canvas mixer.
            "-f", "rawvideo",
            "-pix_fmt", "rgba",
            "-s", &format!("{}x{}", config.width, config.height),
            "-r", &config.fps.to_string(),
            "-i", "pipe:0",
            // Silent audio track. Every RTMP ingest expects one, and a stream
            // with no audio track at all is rejected by several platforms even
            // when the video is perfect.
            "-f", "lavfi",
            "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-tune", "zerolatency",
            "-profile:v", "high",
            "-pix_fmt", "yuv420p",
            "-g", &(config.fps * 2).to_string(),
            "-keyint_min", &config.fps.to_string(),
            "-b:v", &format!("{}k", config.video_bitrate_kbps),
            "-maxrate", &format!("{}k", config.video_bitrate_kbps),
            "-bufsize", &format!("{}k", config.video_bitrate_kbps * 2),
            "-c:a", "aac",
            "-b:a", &format!("{}k", config.audio_bitrate_kbps),
            "-ar", "44100",
            "-ac", "2",
            "-shortest",
            "-f", "tee",
            // Both streams must be mapped explicitly for tee; without this it
            // silently publishes video only.
            "-map", "0:v",
            "-map", "1:a",
            &tee_targets,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Could not start the encoder: {e}"))?;

    *guard = Some(child);
    Ok(())
}

/// Stop the broadcast.
///
/// ffmpeg's stdin is dropped first so it sees end-of-input and flushes a
/// proper end-of-stream to the platform. Killing it outright leaves the
/// broadcast showing as live-but-frozen on the platform's side, sometimes for
/// minutes — the same mistake the server-side pipeline was careful to avoid.
#[tauri::command]
fn stop_broadcast(state: State<AppState>) -> Result<(), String> {
    let mut guard = state.ffmpeg.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = guard.take() {
        drop(child.stdin.take());
        // Give it a moment to flush before insisting.
        std::thread::sleep(std::time::Duration::from_millis(600));
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
fn broadcast_running(state: State<AppState>) -> bool {
    state.ffmpeg.lock().map(|g| g.is_some()).unwrap_or(false)
}

/// Feed one composited frame to the encoder.
///
/// Called from the mixer's render loop with raw RGBA bytes. Errors are
/// reported rather than swallowed so the UI can tell the operator the stream
/// has stopped — silently dropping frames is how you end up broadcasting
/// nothing to a full auditorium and not knowing.
#[tauri::command]
fn push_frame(state: State<AppState>, frame: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    let mut guard = state.ffmpeg.lock().map_err(|e| e.to_string())?;
    let child = guard.as_mut().ok_or("No broadcast is running.")?;
    let stdin = child.stdin.as_mut().ok_or("Encoder input is closed.")?;
    stdin
        .write_all(&frame)
        .map_err(|e| format!("The encoder stopped accepting frames: {e}"))
}

/// Which platform we are on — the UI adapts its virtual-camera guidance.
#[tauri::command]
fn platform_info() -> serde_json::Value {
    serde_json::json!({
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}

// ── Entry point ─────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_os::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            check_ffmpeg,
            start_broadcast,
            stop_broadcast,
            broadcast_running,
            push_frame,
            platform_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MultiCam");
}
