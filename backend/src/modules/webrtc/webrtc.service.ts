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

// ── Worker pool ────────────────────────────────────────────────────

export async function initWorkers(): Promise<void> {
  const count = Math.min(os.cpus().length, 4);
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
    // Large initial/max bitrates to prevent throttling during burst
    initialAvailableOutgoingBitrate: 1_000_000,
    
    maxSctpMessageSize: 262144,
  });

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
