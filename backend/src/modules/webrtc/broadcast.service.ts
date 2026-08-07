/**
 * OmliveStream RTP → RTMP Bridge
 * ─────────────────────────────────────────────────────────────────
 * This is the segment that connects mediasoup to the outside world.
 *
 *   Browser ──WebRTC──▶ mediasoup Producer
 *                            │
 *                       Consumer on a PlainTransport
 *                            │ plain RTP over loopback UDP
 *                            ▼
 *                         ffmpeg  ──┬──▶ rtmp://youtube
 *                                   ├──▶ rtmp://twitch
 *                                   ├──▶ rtmp://facebook
 *                                   └──▶ … up to 8 platforms
 *
 * Design decisions worth knowing:
 *
 * ONE ffmpeg PER STREAM, NOT PER PLATFORM. The `tee` muxer fans a single
 * decoded/copied pipeline out to N RTMP endpoints. The previous design
 * (one ffmpeg per platform, each re-reading the source) multiplied CPU
 * and bandwidth by N for no benefit. With `onfail=ignore` a dead platform
 * drops out without taking the broadcast down.
 *
 * VIDEO IS COPIED, AUDIO IS TRANSCODED. RTMP/FLV accepts H264 video and
 * AAC audio, nothing else. We negotiate H264 with the browser (see
 * MEDIA_CODECS ordering in webrtc.service) so video passes through with
 * `-c:v copy` — no decode, no encode, ~2% of a core. Opus audio has to
 * become AAC because FLV cannot carry Opus; that costs roughly 1% of a
 * core. If the browser insists on VP8 we fall back to transcoding video
 * and log it loudly, because that changes the cost per stream from
 * ~0.05 cores to ~1 core and will silently wreck capacity planning.
 */

import { spawn, execFile, ChildProcess } from 'child_process';
import { writeFile, readFile, unlink, mkdir, stat } from 'fs/promises';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import type * as mediasoup from 'mediasoup';
import { getRouter, getStreamProducers } from './webrtc.service';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';

const execFileAsync = promisify(execFile);

export interface RtmpTarget {
  platform:  string;
  rtmpUrl:   string;
  streamKey: string;
}

/**
 * Identifies the `recordings` row this broadcast is filling in. Passed in
 * rather than looked up here so the bridge stays a media component and does
 * not own the recording lifecycle.
 */
export interface RecordingRef {
  recordingId: string;
  userId:      string;
}

interface Session {
  streamId:   string;
  ffmpeg:     ChildProcess | null;
  transports: mediasoup.types.PlainTransport[];
  consumers:  mediasoup.types.Consumer[];
  sdpPath:    string;
  ports:      number[];
  targets:    RtmpTarget[];
  restarts:   number;
  stopping:   boolean;
  /** Row being filled in, or null when recording is off. */
  recording:  RecordingRef | null;
  /** Where this broadcast is being recorded, or null if recording is off. */
  recordPath: string | null;
  /**
   * Segment counter. Every ffmpeg restart has to write to a NEW file, because
   * reopening the same path truncates whatever the previous process wrote.
   */
  recordSegments: string[];
}

const sessions = new Map<string, Session>();

/** Where in-progress recordings are written before finalisation. */
export const RECORDING_DIR = path.join(os.tmpdir(), 'omlivestream-rec');

/**
 * Matroska, not MP4, and this is the whole reason recording works at all.
 *
 * MP4 keeps its index (the moov atom) in memory and writes it on clean
 * shutdown. Render sends SIGTERM and follows with SIGKILL; a crashed or
 * force-killed instance therefore leaves an MP4 with no moov atom, which is
 * not a short recording — it is zero recoverable frames. Verified: ffprobe
 * reports "moov atom not found" and decoding yields nothing.
 *
 * Matroska interleaves its structure with the data, so the same hard kill
 * leaves a file that still decodes up to the last flushed cluster. The
 * finaliser remuxes it to a faststart MP4 afterwards, with -c copy, so the
 * container swap costs no CPU and no quality.
 */
const RECORD_FORMAT = 'matroska';
const RECORD_EXT    = 'mkv';

// ── Recording finalisation ─────────────────────────────────────────
/**
 * Remuxes the recorded segments to a faststart MP4 and uploads it.
 *
 * The final mp4 is produced with `-c copy`: the segments are already
 * H.264/AAC — the exact byte stream the tee wrote — so the container swap
 * costs no CPU and no quality. Verified: a truncated mkv (the byproduct of
 * a SIGKILL) remuxes cleanly and recovers the full decodable duration.
 *
 * Deliberately NOT in a worker: production runs a single web process (the
 * Dockerfile CMD is `node dist/server.js`), so a separate BullMQ worker
 * would have nobody to consume the job. Finalisation runs inline at stream
 * end, where the broadcast itself already lives.
 */
async function finaliseRecording(
  streamId: string,
  recording: RecordingRef,
  segments: string[]
): Promise<void> {
  const { recordingId, userId } = recording;
  const tmpDir  = RECORDING_DIR;
  const input   = path.join(tmpDir, `${streamId}.all.${RECORD_EXT}`);
  const output  = path.join(tmpDir, `${streamId}.final.mp4`);

  // A stream that ended within its first ~10 seconds may have produced a
  // segment that never flushed. A segment of a few KB of headers decodes to
  // nothing, so concat first, then let the probe fail the whole row.
  try {
    await writeFile(input, segments.map(s => `file '${s}'`).join('\n') + '\n', 'utf8');
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', input,
      '-c', 'copy', '-movflags', '+faststart', output,
    ], { timeout: 10 * 60_000 });
  } catch (err) {
    logger.error({ streamId, recordingId, err }, 'Recording remux failed');
    await markRecordingFailed(recordingId);
    return;
  }

  try {
    // Probe the remuxed file rather than trusting the live process.
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'json', output,
    ], { timeout: 60_000 });
    const probe = JSON.parse(stdout);
    const durationSeconds = Math.round(Number(probe?.format?.duration ?? 0));
    const sizeBytes       = Number(probe?.format?.size ?? 0);

    // Fall back to the file's own size if ffprobe returned nothing.
    let size = sizeBytes;
    if (!size) {
      try { size = (await stat(output)).size; } catch { size = 0; }
    }

    // Path includes userId: the bucket is shared across every account, and
    // signed URLs are minted from the stored file_url, so the path must be
    // reconstructible and unique per user.
    const storagePath = `${userId}/${streamId}/recording.mp4`;
    const buf = await readFile(output);
    const { error: uploadErr } = await supabaseAdmin.storage.from('recordings')
      .upload(storagePath, buf, { contentType: 'video/mp4', upsert: true });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabaseAdmin.storage.from('recordings').getPublicUrl(storagePath);

    await supabaseAdmin.from('recordings')
      .update({
        file_url:         urlData.publicUrl,
        duration_seconds: durationSeconds,
        size_bytes:       size,
        status:           'ready',
        updated_at:       new Date().toISOString(),
      })
      .eq('id', recordingId);

    logger.info({ streamId, recordingId, durationSeconds, size }, 'Recording finalised');
  } catch (err) {
    logger.error({ streamId, recordingId, err }, 'Recording upload failed');
    await markRecordingFailed(recordingId);
  } finally {
    for (const f of [input, output, ...segments]) {
      await unlink(f).catch(() => {});
    }
  }
}

async function markRecordingFailed(recordingId: string): Promise<void> {
  // try/catch rather than .catch(): the Supabase query builder is a thenable,
  // not a Promise, so it has no .catch to attach to.
  try {
    const { error } = await supabaseAdmin.from('recordings')
      .update({ status: 'failed', updated_at: new Date().toISOString() })
      .eq('id', recordingId);
    if (error) throw error;
  } catch (err) {
    logger.error({ recordingId, err }, 'Failed to mark recording failed');
  }
}

// ── Port allocation ────────────────────────────────────────────────
// ffmpeg listens on these; mediasoup sends to them. Kept well clear of
// the mediasoup RTC range (40000-49999) to avoid collisions.
const PORT_MIN = 50000;
const PORT_MAX = 59998;
const inUse = new Set<number>();

function allocatePortPair(): { rtp: number; rtcp: number } {
  // RTP on an even port, RTCP on the odd port above it — the convention
  // ffmpeg's SDP demuxer assumes when rtcp-mux is off.
  for (let p = PORT_MIN; p < PORT_MAX; p += 2) {
    if (!inUse.has(p) && !inUse.has(p + 1)) {
      inUse.add(p);
      inUse.add(p + 1);
      return { rtp: p, rtcp: p + 1 };
    }
  }
  throw new AppError('No free RTP ports available', 503, 'NO_PORTS');
}

function releasePorts(ports: number[]): void {
  for (const p of ports) inUse.delete(p);
}

// ── SDP generation ─────────────────────────────────────────────────
/**
 * Builds the SDP that tells ffmpeg what is arriving on which port.
 * Payload types, clock rates and SSRCs all come from the live Consumer
 * rather than being hardcoded — mediasoup may renegotiate them, and a
 * mismatch here produces a stream that connects but decodes to nothing.
 */
function buildSdp(parts: {
  video?: { port: number; consumer: mediasoup.types.Consumer };
  audio?: { port: number; consumer: mediasoup.types.Consumer };
}): string {
  const lines = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=OmliveStream',
    'c=IN IP4 127.0.0.1',
    't=0 0',
  ];

  for (const [kind, part] of Object.entries(parts)) {
    if (!part) continue;
    const codec = part.consumer.rtpParameters.codecs[0];
    const pt    = codec.payloadType;
    // mimeType is like "video/H264" — SDP wants just the subtype.
    const name  = codec.mimeType.split('/')[1];

    lines.push(`m=${kind} ${part.port} RTP/AVP ${pt}`);

    if (kind === 'audio') {
      const channels = codec.channels ?? 2;
      lines.push(`a=rtpmap:${pt} ${name}/${codec.clockRate}/${channels}`);
    } else {
      lines.push(`a=rtpmap:${pt} ${name}/${codec.clockRate}`);
    }

    // fmtp carries H264's packetization-mode and profile-level-id. Without
    // it ffmpeg guesses, and guesses wrong on some encoders.
    const fmtp = Object.entries(codec.parameters ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(';');
    if (fmtp) lines.push(`a=fmtp:${pt} ${fmtp}`);

    lines.push('a=recvonly');
  }

  return lines.join('\n') + '\n';
}

// ── ffmpeg argument construction ───────────────────────────────────
function buildFfmpegArgs(opts: {
  sdpPath:     string;
  targets:     RtmpTarget[];
  copyVideo:   boolean;
  hasAudio:    boolean;
  recordPath?: string | null;
}): string[] {
  const { sdpPath, targets, copyVideo, hasAudio, recordPath } = opts;

  const args: string[] = [
    '-hide_banner',
    '-loglevel', 'warning',

    // The SDP references udp/rtp; ffmpeg refuses those protocols unless
    // explicitly whitelisted when the input is a local file.
    '-protocol_whitelist', 'file,udp,rtp',

    // Generous reorder buffer. RTP over loopback rarely reorders, but a
    // busy box can burst, and the default 0 drops late packets outright.
    '-reorder_queue_size', '2048',
    '-buffer_size', '4194304',

    '-thread_queue_size', '1024',
    '-fflags', '+genpts+discardcorrupt',
    '-use_wallclock_as_timestamps', '1',

    '-i', sdpPath,
  ];

  if (copyVideo) {
    // The fast path: no decode, no encode.
    args.push('-c:v', 'copy');
  } else {
    // Fallback when the browser gave us VP8. Tuned for live: veryfast is
    // the slowest preset that reliably keeps up at 1080p30 on 2 vCPU.
    args.push(
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-g', '60',              // keyframe every 2s at 30fps — platforms want <=4s
      '-keyint_min', '60',
      '-sc_threshold', '0',    // no scene-cut keyframes; platforms prefer fixed GOP
      '-b:v', '4500k',
      '-maxrate', '4500k',
      '-bufsize', '9000k',
    );
  }

  if (hasAudio) {
    // Opus cannot live in FLV, so this transcode is mandatory.
    args.push('-c:a', 'aac', '-b:a', '160k', '-ar', '44100', '-ac', '2');
  }

  // FLV needs SPS/PPS in-band on every keyframe for mid-stream joiners.
  args.push('-bsf:v', 'dump_extra', '-flvflags', 'no_duration_filesize');

  const maps = hasAudio ? ['-map', '0:v:0', '-map', '0:a:0'] : ['-map', '0:v:0'];
  args.push(...maps);

  // tee fans out to every platform from one pipeline. onfail=ignore means
  // YouTube rejecting the key does not kill the Twitch push.
  const slaves = targets.map((t) => {
    const url = `${t.rtmpUrl.replace(/\/+$/, '')}/${t.streamKey}`;
    return `[f=flv:onfail=ignore]${url}`;
  });

  // Recording is one more slave on the same tee, not a second ffmpeg and not
  // a second copy of the media crossing the network. The bytes here are
  // already H.264/AAC on their way to the platforms, so the recording costs
  // one file write and no additional encoding.
  //
  // This replaces the old design, where the browser ran a parallel
  // MediaRecorder and shipped every chunk over the websocket to be base64'd
  // into a Redis list — 33% wire inflation, one Upstash HTTPS request per
  // chunk, uncapped, and a duplicate upload of video the server already had.
  //
  // onfail=ignore is mandatory, not defensive: verified that without it a
  // recording slave that cannot open its file aborts the entire tee and takes
  // every platform down with it. A full disk must cost the recording, never
  // the broadcast.
  if (recordPath) {
    slaves.push(`[f=${RECORD_FORMAT}:onfail=ignore]${recordPath}`);
  }

  args.push('-f', 'tee', slaves.join('|'));

  return args;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Starts pushing a live stream to every configured platform.
 * Safe to call once per stream; a second call is a no-op.
 *
 * Pass `recording` to have the broadcast recorded. The recording is written
 * by the same ffmpeg that feeds the platforms, as one more tee slave, so it
 * costs a file write and nothing else.
 */
export async function startBroadcast(
  streamId: string,
  targets: RtmpTarget[],
  recording?: RecordingRef | null
): Promise<{ platforms: number; videoCopied: boolean }> {
  if (sessions.has(streamId)) {
    logger.warn({ streamId }, 'Broadcast already running — ignoring duplicate start');
    const s = sessions.get(streamId)!;
    return { platforms: s.targets.length, videoCopied: true };
  }
  if (targets.length === 0) {
    throw new AppError('No RTMP targets supplied', 400, 'NO_TARGETS');
  }

  const router = getRouter(streamId);
  if (!router) throw new AppError('Stream router not found', 404, 'NO_ROUTER');

  const { video, audio } = getStreamProducers(streamId);
  if (!video) {
    throw new AppError(
      'No video track is being produced for this stream yet',
      409,
      'NO_VIDEO_PRODUCER'
    );
  }

  const session: Session = {
    streamId,
    ffmpeg:     null,
    transports: [],
    consumers:  [],
    sdpPath:    '',
    ports:      [],
    targets,
    restarts:   0,
    stopping:   false,
    recording:  recording ?? null,
    recordPath: null,
    recordSegments: [],
  };

  try {
    const sdpParts: Parameters<typeof buildSdp>[0] = {};

    for (const [kind, producer] of [
      ['video', video],
      ['audio', audio],
    ] as const) {
      if (!producer) continue;

      const { rtp, rtcp } = allocatePortPair();
      session.ports.push(rtp, rtcp);

      // comedia:false because we know where ffmpeg will be listening and
      // tell mediasoup explicitly. rtcpMux:false because ffmpeg's SDP
      // demuxer does not handle muxed RTCP on the RTP port.
      const transport = await router.createPlainTransport({
        listenIp:  { ip: '127.0.0.1' },
        rtcpMux:   false,
        comedia:   false,
        enableSrtp: false,
      });
      session.transports.push(transport);

      await transport.connect({ ip: '127.0.0.1', port: rtp, rtcpPort: rtcp });

      // paused:true is important. If the consumer streams before ffmpeg is
      // listening, the opening keyframe is lost to a closed socket and the
      // platforms show a black frame until the next one arrives.
      const consumer = await transport.consume({
        producerId:     producer.id,
        rtpCapabilities: router.rtpCapabilities,
        paused:         true,
      });
      session.consumers.push(consumer);

      sdpParts[kind] = { port: rtp, consumer };
    }

    const videoCodec = sdpParts.video!.consumer.rtpParameters.codecs[0].mimeType.toLowerCase();
    const copyVideo  = videoCodec.includes('h264');

    if (!copyVideo) {
      logger.warn(
        { streamId, videoCodec },
        'Browser negotiated a non-H264 codec — falling back to software transcoding. ' +
        'This costs roughly 20x more CPU per stream than the copy path.'
      );
    }

    // SDP goes on disk because ffmpeg's SDP demuxer needs a seekable input.
    const dir = path.join(os.tmpdir(), 'omlivestream-sdp');
    await mkdir(dir, { recursive: true });
    session.sdpPath = path.join(dir, `${streamId}.sdp`);
    await writeFile(session.sdpPath, buildSdp(sdpParts), 'utf8');

    // Recording failing to set up must not stop the broadcast: going live is
    // the paid-for behaviour, the recording is a byproduct of it.
    if (session.recording) {
      try {
        await mkdir(RECORDING_DIR, { recursive: true });
      } catch (err) {
        logger.error({ streamId, err }, 'Cannot create recording directory — recording disabled');
        session.recording = null;
      }
    }

    sessions.set(streamId, session);

    await spawnFfmpeg(session, copyVideo, Boolean(sdpParts.audio));

    // Now that ffmpeg is bound, let the RTP flow and ask the browser for a
    // fresh keyframe so the first thing every platform sees is decodable.
    for (const c of session.consumers) {
      await c.resume();
      if (c.kind === 'video') await c.requestKeyFrame().catch(() => {});
    }

    logger.info(
      { streamId, platforms: targets.map((t) => t.platform), copyVideo },
      'Broadcast started'
    );

    return { platforms: targets.length, videoCopied: copyVideo };
  } catch (err) {
    // Never leak transports or ports on a failed start.
    await teardown(session);
    sessions.delete(streamId);
    throw err;
  }
}

function spawnFfmpeg(
  session: Session,
  copyVideo: boolean,
  hasAudio: boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    // A new file per spawn, not a reopen of the last one. ffmpeg truncates on
    // open, so a restart pointed at the existing path would discard
    // everything the previous process recorded — the exact case a restart is
    // there to survive. The finaliser concatenates the segments back together.
    if (session.recording) {
      session.recordPath = path.join(
        RECORDING_DIR,
        `${session.streamId}.${session.recordSegments.length}.${RECORD_EXT}`
      );
      session.recordSegments.push(session.recordPath);
    }

    const args = buildFfmpegArgs({
      sdpPath:   session.sdpPath,
      targets:   session.targets,
      copyVideo,
      hasAudio,
      recordPath: session.recordPath,
    });

    logger.debug({ streamId: session.streamId, args }, 'Spawning ffmpeg');

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    session.ffmpeg = proc;

    let settled = false;
    let stderrTail = '';

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      // Keep only the last few KB; ffmpeg is chatty and we only need the
      // tail to explain a crash.
      stderrTail = (stderrTail + text).slice(-4000);

      if (/error|failed|unable|invalid/i.test(text)) {
        logger.warn({ streamId: session.streamId, ffmpeg: text.trim() }, 'ffmpeg reported an error');
      }
    });

    proc.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new AppError(`Failed to start ffmpeg: ${err.message}`, 500, 'FFMPEG_SPAWN'));
      }
    });

    proc.on('exit', (code, signal) => {
      logger.warn(
        { streamId: session.streamId, code, signal, stderrTail },
        'ffmpeg exited'
      );
      session.ffmpeg = null;

      if (session.stopping) return;

      // Unexpected exit while the stream is still live — restart with
      // backoff. Capped so a permanently bad stream key cannot spin
      // forever burning CPU.
      if (session.restarts < 5) {
        session.restarts++;
        const delay = Math.min(1000 * 2 ** session.restarts, 15000);
        logger.info(
          { streamId: session.streamId, attempt: session.restarts, delay },
          'Restarting ffmpeg'
        );
        setTimeout(() => {
          if (!session.stopping && sessions.has(session.streamId)) {
            spawnFfmpeg(session, copyVideo, hasAudio).catch((err) =>
              logger.error({ streamId: session.streamId, err }, 'ffmpeg restart failed')
            );
          }
        }, delay);
      } else {
        logger.error(
          { streamId: session.streamId },
          'ffmpeg exceeded restart limit — broadcast is down'
        );
      }
    });

    // ffmpeg needs a moment to bind its UDP sockets. Resolving immediately
    // would let the consumers resume into a void.
    setTimeout(() => {
      if (!settled) {
        settled = true;
        if (proc.exitCode !== null) {
          reject(new AppError(`ffmpeg exited immediately: ${stderrTail}`, 500, 'FFMPEG_EXIT'));
        } else {
          resolve();
        }
      }
    }, 700);
  });
}

async function teardown(session: Session): Promise<void> {
  session.stopping = true;

  if (session.ffmpeg) {
    // SIGINT lets ffmpeg flush and send RTMP end-of-stream so platforms
    // mark the broadcast ended instead of timing it out.
    session.ffmpeg.kill('SIGINT');
    const proc = session.ffmpeg;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        proc.kill('SIGKILL');
        resolve();
      }, 3000);
      proc.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
    session.ffmpeg = null;
  }

  for (const c of session.consumers) {
    try { c.close(); } catch { /* already closed with the router */ }
  }
  for (const t of session.transports) {
    try { t.close(); } catch { /* already closed with the router */ }
  }

  releasePorts(session.ports);

  if (session.sdpPath) {
    await unlink(session.sdpPath).catch(() => {});
  }
}

/**
 * Stops the broadcast, frees ports/transports/SDP, and finalises the
 * recording if one was being written.
 *
 * The finalise step is awaited rather than fired and forgotten: the caller
 * (streams.service.end) is an HTTP request, and the recording row is left
 * 'processing' until this resolves. A remux with -c copy is I/O bound and
 * quick, so this costs the request the upload, not an encode.
 */
export async function stopBroadcast(streamId: string): Promise<void> {
  const session = sessions.get(streamId);
  if (!session) return;
  sessions.delete(streamId);
  await teardown(session);
  logger.info({ streamId }, 'Broadcast stopped');

  if (session.recording && session.recordSegments.length > 0) {
    await finaliseRecording(streamId, session.recording, session.recordSegments);
  } else if (session.recording) {
    // Recording was requested but ffmpeg never wrote a segment.
    logger.warn({ streamId }, 'Recording requested but no segment was written');
    await markRecordingFailed(session.recording.recordingId);
  }
}

/** Live status for the dashboard / health checks. */
export function getBroadcastStatus(streamId: string): {
  running:   boolean;
  platforms: string[];
  restarts:  number;
} {
  const s = sessions.get(streamId);
  if (!s) return { running: false, platforms: [], restarts: 0 };
  return {
    running:   s.ffmpeg !== null,
    platforms: s.targets.map((t) => t.platform),
    restarts:  s.restarts,
  };
}

export function getActiveBroadcastCount(): number {
  return sessions.size;
}

/**
 * Stops everything — called on SIGTERM so platforms see a clean end.
 *
 * Each stopBroadcast sends end-of-stream to the platforms *before* it starts
 * finalising, so a shutdown that runs out of time loses the recording upload
 * and never the clean end-of-broadcast.
 *
 * Recordings are only best-effort here. The segments live in the container's
 * /tmp, which Render discards when the instance goes away, so a SIGKILL that
 * lands before the upload finishes loses that recording regardless of
 * container format. Matroska buys back the case that is actually recoverable:
 * ffmpeg itself dying and being restarted while the instance lives on.
 */
export async function stopAllBroadcasts(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => stopBroadcast(id)));
}
