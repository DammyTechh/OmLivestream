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

import { spawn, ChildProcess } from 'child_process';
import { writeFile, unlink, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import type * as mediasoup from 'mediasoup';
import { getRouter, getStreamProducers } from './webrtc.service';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';

export interface RtmpTarget {
  platform:  string;
  rtmpUrl:   string;
  streamKey: string;
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
}

const sessions = new Map<string, Session>();

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
}): string[] {
  const { sdpPath, targets, copyVideo, hasAudio } = opts;

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
  const teeTargets = targets
    .map((t) => {
      const url = `${t.rtmpUrl.replace(/\/+$/, '')}/${t.streamKey}`;
      return `[f=flv:onfail=ignore]${url}`;
    })
    .join('|');

  args.push('-f', 'tee', teeTargets);

  return args;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Starts pushing a live stream to every configured platform.
 * Safe to call once per stream; a second call is a no-op.
 */
export async function startBroadcast(
  streamId: string,
  targets: RtmpTarget[]
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
    const args = buildFfmpegArgs({
      sdpPath:   session.sdpPath,
      targets:   session.targets,
      copyVideo,
      hasAudio,
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

/** Stops the broadcast and frees ports, transports and the SDP file. */
export async function stopBroadcast(streamId: string): Promise<void> {
  const session = sessions.get(streamId);
  if (!session) return;
  sessions.delete(streamId);
  await teardown(session);
  logger.info({ streamId }, 'Broadcast stopped');
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

/** Stops everything — called on SIGTERM so platforms see a clean end. */
export async function stopAllBroadcasts(): Promise<void> {
  await Promise.all([...sessions.keys()].map((id) => stopBroadcast(id)));
}
