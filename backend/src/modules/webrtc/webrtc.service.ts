/**
 * OmliveStream WebRTC Service
 * ─────────────────────────────────────────────────────────────────
 * Manages mediasoup Workers, Routers, WebRtcTransports, Producers.
 *
 * Stream quality pipeline:
 *   Browser Canvas (60fps) → mediasoup Producer → RTP → ffmpeg → RTMP → Go Relay → Platforms
 *
 * No re-encoding inside mediasoup (pure SFU forward) — this is what
 * keeps latency sub-100ms and CPU usage minimal.
 */

import * as mediasoup from 'mediasoup';
import os from 'os';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { AppError, NotFoundError } from '../../utils/errors';

// ── Codec config ───────────────────────────────────────────────────
// H264 is listed FIRST deliberately. RTMP/FLV — which every platform
// ingests — only accepts H264 video. When the browser produces H264 we
// can forward with `-c:v copy` (zero transcoding, near-zero CPU). If it
// produces VP8 we are forced to transcode, which costs ~1 core per
// stream. mediasoup-client picks the first mutually supported codec, so
// ordering here is what keeps us in the copy path.
//
// rtcpFeedback is populated (was empty) so congestion control actually
// works — without NACK/PLI/REMB the browser never retransmits lost
// packets and never receives bitrate feedback.
const MEDIA_CODECS: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: 'video', mimeType: 'video/H264', clockRate: 90000,
    preferredPayloadType: 125,
    parameters: {
      'packetization-mode': 1,
      'profile-level-id': '42e01f',
      'level-asymmetry-allowed': 1,
    },
    rtcpFeedback: [
      { type: 'nack' },
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm',  parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
  {
    kind: 'video', mimeType: 'video/VP8', clockRate: 90000,
    preferredPayloadType: 96,
    parameters: {},
    rtcpFeedback: [
      { type: 'nack' },
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm',  parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
  {
    kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2,
    preferredPayloadType: 111,
    parameters: { 'sprop-stereo': 1, useinbandfec: 1, usedtx: 1 },
    rtcpFeedback: [{ type: 'transport-cc' }],
  },
];

// ── In-process store (scale to Redis for multi-node) ───────────────
const workers:   mediasoup.types.Worker[]                          = [];
const routers:   Map<string, mediasoup.types.Router>               = new Map(); // streamId → Router
const transports:Map<string, mediasoup.types.WebRtcTransport>      = new Map(); // transportId → Transport
const producers: Map<string, mediasoup.types.Producer>             = new Map(); // producerId → Producer
let   workerIdx  = 0;

// transportId → streamId, and streamId → its producers.
// The RTP bridge needs to find "the video producer for stream X" when the
// stream goes live; without this mapping producers are an undifferentiated
// pool and there is no way to know which tracks belong to which broadcast.
const transportStream: Map<string, string> = new Map();
const streamProducers: Map<string, { video?: string; audio?: string }> = new Map();

export function getStreamProducers(streamId: string): {
  video?: mediasoup.types.Producer;
  audio?: mediasoup.types.Producer;
} {
  const ids = streamProducers.get(streamId);
  if (!ids) return {};
  return {
    video: ids.video ? producers.get(ids.video) : undefined,
    audio: ids.audio ? producers.get(ids.audio) : undefined,
  };
}

/**
 * Ceiling on what a creator's browser may send us, in bits per second.
 *
 * 5 Mbps: enough for 1080p30 at the bitrate YouTube and Twitch publish as
 * their recommendation, with room for the burst after a keyframe. Raising it
 * further mostly buys larger bursts rather than visibly better video, and
 * costs bandwidth on every concurrent stream.
 */
const MAX_INCOMING_BITRATE = 5_000_000;

// ── Worker pool ────────────────────────────────────────────────────

export async function initWorkers(): Promise<void> {
  /**
   * One worker per core, by mediasoup's own guidance.
   *
   * A mediasoup worker is a single-threaded C++ process, so a worker count
   * below the core count leaves cores idle no matter how many creators are
   * live. This used to be capped at 4, which was fine on a small box and
   * quietly wasted more than half of a bigger one — precisely the machine you
   * move to when streaming quality starts to matter.
   *
   * Routers are handed out round-robin (see nextWorker), so raising the count
   * spreads live streams across more cores rather than piling them onto four.
   *
   * MEDIASOUP_NUM_WORKERS overrides it when the box is shared with other work
   * and you want to reserve headroom. Clamped to at least 1 so a bad value
   * cannot leave the pool empty, which would fail every go-live.
   */
  const configured = Number(process.env.MEDIASOUP_NUM_WORKERS);
  const count = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : Math.max(1, os.cpus().length);
  for (let i = 0; i < count; i++) {
    const worker = await mediasoup.createWorker({
      rtcMinPort:   env.MEDIASOUP_MIN_PORT,
      rtcMaxPort:   env.MEDIASOUP_MAX_PORT,
      logLevel:     'warn',
      logTags:      ['rtp', 'srtp', 'rtcp', 'dtls', 'ice'],
    });
    worker.on('died', (err) => {
      logger.fatal({ err, workerIndex: i }, 'mediasoup worker died — restarting process');
      process.exit(1);
    });
    workers.push(worker);
    logger.info({ pid: worker.pid }, `mediasoup worker ${i + 1}/${count} started`);
  }
}

function nextWorker(): mediasoup.types.Worker {
  const w = workers[workerIdx % workers.length];
  workerIdx++;
  return w;
}

// ── Router (one per live stream) ───────────────────────────────────

export async function createRouter(streamId: string): Promise<mediasoup.types.RtpCapabilities> {
  if (routers.has(streamId)) {
    return routers.get(streamId)!.rtpCapabilities;
  }
  const router = await nextWorker().createRouter({ mediaCodecs: MEDIA_CODECS });
  routers.set(streamId, router);
  logger.info({ streamId, routerId: router.id }, 'mediasoup Router created');
  return router.rtpCapabilities;
}

export function getRouter(streamId: string): mediasoup.types.Router | undefined {
  return routers.get(streamId);
}

export function closeRouter(streamId: string): void {
  const router = routers.get(streamId);
  if (router) {
    // Closing the Router cascades to its transports, producers and
    // consumers, but the lookup maps are ours to clean up.
    const ids = streamProducers.get(streamId);
    if (ids?.video) producers.delete(ids.video);
    if (ids?.audio) producers.delete(ids.audio);
    streamProducers.delete(streamId);

    for (const [tid, sid] of transportStream) {
      if (sid === streamId) {
        transports.delete(tid);
        transportStream.delete(tid);
      }
    }

    router.close();
    routers.delete(streamId);
    logger.info({ streamId }, 'mediasoup Router closed');
  }
}

// ── WebRTC Transport (one per browser connection direction) ────────

export interface TransportParams {
  id: string;
  iceParameters: mediasoup.types.IceParameters;
  iceCandidates: mediasoup.types.IceCandidate[];
  dtlsParameters: mediasoup.types.DtlsParameters;
  /** Required by mediasoup-client's `device.load()` before it can produce. */
  routerRtpCapabilities: mediasoup.types.RtpCapabilities;
}

export async function createWebRtcTransport(streamId: string): Promise<TransportParams> {
  const router = routers.get(streamId);
  if (!router) throw new NotFoundError('Stream router');

  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: env.MEDIASOUP_LISTEN_IP, announcedIp: env.MEDIASOUP_ANNOUNCED_IP }],
    enableUdp:  true,
    enableTcp:  true,  // fallback for restrictive networks
    preferUdp:  true,  // UDP = lower latency
    enableSctp: false,
    // Headroom for the outgoing direction so bandwidth estimation does not
    // start conservatively and ramp.
    initialAvailableOutgoingBitrate: 1_000_000,
  });

  /**
   * Raise the ceiling on what the browser is allowed to send us.
   *
   * This is the setting that decides broadcast quality. The transport here is
   * effectively send-only — the creator's browser produces, the server
   * consumes — and `initialAvailableOutgoingBitrate` only governs the
   * *outgoing* direction, so it was doing nothing for the video that actually
   * reaches YouTube or Twitch. Incoming bitrate is governed by
   * setMaxIncomingBitrate, which was never called.
   *
   * Left uncalled, mediasoup's default keeps the sender well below what a
   * decent connection can carry, and the creator sees a soft, low-detail
   * 720p even on fibre. 5 Mbps comfortably covers 1080p30 and matches what
   * YouTube and Twitch recommend for that resolution, while still leaving the
   * browser's own congestion control free to back off on a weak network —
   * this raises the ceiling, it does not force the rate.
   *
   * Non-fatal on failure: an unsupported transport should degrade to the
   * previous behaviour, not stop someone going live.
   */
  try {
    await transport.setMaxIncomingBitrate(MAX_INCOMING_BITRATE);
  } catch (err) {
    logger.warn({ err, streamId }, 'Could not raise max incoming bitrate — using mediasoup default');
  }

  // Auto-close on inactivity
  transport.on('dtlsstatechange', (state) => {
    if (state === 'failed' || state === 'closed') {
      transport.close();
      transports.delete(transport.id);
      transportStream.delete(transport.id);
    }
  });

  transports.set(transport.id, transport);
  transportStream.set(transport.id, streamId);
  logger.debug({ streamId, transportId: transport.id }, 'WebRTC transport created');

  return {
    id:              transport.id,
    iceParameters:   transport.iceParameters,
    iceCandidates:   transport.iceCandidates,
    dtlsParameters:  transport.dtlsParameters,
    /**
     * The router's capabilities, returned alongside the transport.
     *
     * mediasoup-client can do nothing until `device.load()` has been given
     * these — it must know which codecs the server speaks before it can
     * negotiate a producer. Without them there is no client-side path at all,
     * which is why native publishing could not be built against this endpoint.
     *
     * Sent here rather than from a separate route to keep it to one round
     * trip: tapping "go live" should not wait on two sequential requests
     * before the camera starts negotiating. Adding a field is backward
     * compatible — the web client ignores what it does not read.
     */
    routerRtpCapabilities: router.rtpCapabilities,
  };
}

export async function connectTransport(
  transportId: string,
  dtlsParameters: mediasoup.types.DtlsParameters
): Promise<void> {
  const transport = transports.get(transportId);
  if (!transport) throw new NotFoundError('Transport');
  await transport.connect({ dtlsParameters });
  logger.debug({ transportId }, 'WebRTC transport connected');
}

// ── Producer (browser → server video/audio track) ─────────────────

export interface ProducerResult {
  producerId: string;
}

export async function createProducer(
  transportId: string,
  kind: 'video' | 'audio',
  rtpParameters: mediasoup.types.RtpParameters
): Promise<ProducerResult> {
  const transport = transports.get(transportId);
  if (!transport) throw new NotFoundError('Transport');

  const producer = await transport.produce({
    kind,
    rtpParameters,
    // Pause immediately — frontend calls resume when actually live
    paused: false,
    keyFrameRequestDelay: 0,
  });

  const streamId = transportStream.get(transportId);

  producer.on('transportclose', () => {
    producers.delete(producer.id);
    if (streamId) {
      const entry = streamProducers.get(streamId);
      if (entry?.[kind] === producer.id) delete entry[kind];
    }
  });

  producer.on('score', (score) => {
    logger.debug({ producerId: producer.id, score }, 'Producer score update');
  });

  producers.set(producer.id, producer);

  // Record which stream this track belongs to so the RTP bridge can find it.
  if (streamId) {
    const entry = streamProducers.get(streamId) ?? {};
    entry[kind] = producer.id;
    streamProducers.set(streamId, entry);
  } else {
    logger.warn({ transportId, producerId: producer.id },
      'Producer created on a transport with no stream mapping — RTP bridge will not find it');
  }

  logger.info({ transportId, streamId, producerId: producer.id, kind }, 'Producer created');

  return { producerId: producer.id };
}

export function getProducer(producerId: string): mediasoup.types.Producer | undefined {
  return producers.get(producerId);
}

// ── Stream stats ───────────────────────────────────────────────────

export async function getStreamStats(streamId: string): Promise<{
  routerExists: boolean;
  producers: number;
  transports: number;
}> {
  const router = routers.get(streamId);
  return {
    routerExists: !!router,
    producers:    producers.size,
    transports:   transports.size,
  };
}
