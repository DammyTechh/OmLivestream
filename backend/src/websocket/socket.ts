import { Server as IO, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import { env, corsAllowedOrigins } from '../config/env';
import { redis, REDIS_KEYS, createSocketAdapterClients } from '../config/redis';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../config/logger';
// Imported at module scope, not per-message. This is called on a 2-second
// timer by every live broadcaster; a dynamic import there re-enters the
// module cache on every single tick for no benefit.
import { getAdaptiveRecommendation } from '../modules/streams/network.service';
import type { JwtPayload } from '../types/database';

/** How often a broadcaster's bitrate is actually persisted, in ms. */
const BITRATE_WRITE_INTERVAL_MS = 10_000;

/**
 * Lifetime of a viewer-count key. Longer than any plausible broadcast, so it
 * never expires under a live stream, but finite so a crashed instance's
 * un-decremented viewers cannot haunt the id forever.
 */
const VIEWER_KEY_TTL_SEC = 21_600; // 6 hours

type AuthSocket = Socket & { userId: string; userPlan: string };

/**
 * The live instance, so service-layer code can push to rooms without
 * having the io object threaded through every call signature.
 *
 * Nullable on purpose: services must tolerate its absence rather than
 * assume it. Jobs and workers import the same services but never call
 * initSocketIO, so a non-null assertion here would crash the worker
 * process on the first emit.
 */
let ioRef: IO | null = null;

export function getIO(): IO | null {
  return ioRef;
}

/**
 * Is this stream live? Cached in Redis for a short window.
 *
 * Called once per socket join. A go-live notification lands thousands of
 * viewers on the same stream within seconds, and without this every one of
 * them issues an identical query whose answer is fixed for the duration of
 * the broadcast. The TTL is short so that a stream ending is reflected
 * quickly — the cost of a stale 'live' is a viewer joining a room that has
 * stopped emitting, which resolves itself on the next status event.
 */
const LIVE_CACHE_TTL_SEC = 15;

async function isStreamLive(streamId: string): Promise<boolean> {
  const key = REDIS_KEYS.STREAM_LIVE(streamId);
  // Upstash deserialises JSON on read, so a stored "1" can come back as
  // either the string or the number — compare against both.
  const cached = await redis.get<string | number>(key);
  if (cached !== null && cached !== undefined) return String(cached) === '1';

  const { data } = await supabaseAdmin
    .from('streams').select('status').eq('id', streamId).single();

  const live = data?.status === 'live';
  await redis.set(key, live ? '1' : '0', { ex: LIVE_CACHE_TTL_SEC });
  return live;
}

/**
 * Make rooms span instances.
 *
 * Without an adapter, `io.to('stream:x').emit(...)` reaches only the sockets
 * attached to *this* process. Two Render instances behind one load balancer
 * therefore split a stream's viewers into two isolated halves: a comment
 * ingested by instance A never reaches the viewers parked on instance B, and
 * the viewer count each half reports is its own local total. Nothing errors —
 * it just quietly delivers half the events, which is why this has to be in
 * place before scaling past one instance rather than after.
 *
 * Best-effort by design. If the adapter cannot be loaded or no TCP Redis URL
 * is configured, the server still starts and is still correct on a single
 * instance; it just logs loudly enough that nobody scales up believing
 * fan-out works.
 */
let adapterClients: { pub: any; sub: any } | null = null;

function attachRedisAdapter(io: IO): void {
  const clients = createSocketAdapterClients();
  if (!clients) {
    logger.warn(
      'Socket.io running WITHOUT a Redis adapter (UPSTASH_REDIS_URL unset). ' +
      'Rooms do not span processes — run exactly one instance, or comments and ' +
      'viewer counts will only reach the half of your viewers on the same process.',
    );
    return;
  }

  try {
    const { createAdapter } = require('@socket.io/redis-adapter');
    io.adapter(createAdapter(clients.pub, clients.sub));
    adapterClients = clients;
    logger.info('Socket.io Redis adapter attached — rooms span instances.');
  } catch (err) {
    // Close what we opened; leaving two idle TCP connections per boot behind
    // a failed attach is how you exhaust an Upstash connection limit.
    clients.pub.quit?.().catch(() => {});
    clients.sub.quit?.().catch(() => {});
    logger.error(
      { err },
      'Could not attach the Socket.io Redis adapter — is @socket.io/redis-adapter installed? ' +
      'Continuing single-instance: cross-instance fan-out is NOT active.',
    );
  }
}

/** Release the adapter's TCP connections on shutdown. */
export async function closeSocketAdapter(): Promise<void> {
  if (!adapterClients) return;
  await Promise.allSettled([adapterClients.pub.quit(), adapterClients.sub.quit()]);
  adapterClients = null;
}

export function initSocketIO(httpServer: http.Server): IO {
  const io = new IO(httpServer, {
    cors: {
      // Same allowlist as the REST API — dashboard.* connects over WS too,
      // so a single FRONTEND_URL here would reject every subdomain.
      origin:      corsAllowedOrigins,
      methods:     ['GET', 'POST'],
      credentials: true,
    },
    transports:      ['websocket', 'polling'],
    pingInterval:    25000,
    pingTimeout:     20000,
    maxHttpBufferSize: 1e7, // 10 MB — for recording chunk uploads
  });

  // Before any listener is registered, so no event can be emitted into a
  // room while fan-out is still process-local.
  attachRedisAdapter(io);

  // ── Auth middleware ──────────────────────────────────────────────
  io.use((socket: Socket, next) => {
    const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
    if (!token) return next(new Error('Authentication token required'));
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
      (socket as AuthSocket).userId   = payload.sub;
      (socket as AuthSocket).userPlan = payload.plan;
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Connection ───────────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const s       = socket as AuthSocket;
    const userId  = s.userId;
    const plan    = s.userPlan;
    logger.debug({ userId, socketId: socket.id }, 'Socket connected');

    /**
     * Which streams this socket counts towards.
     *
     * The counter is a bare Redis integer, so it only stays honest if every
     * INCR is matched by exactly one DECR. Tracking membership here is what
     * makes that true in the two cases the event handlers alone miss: a client
     * that emits join:stream twice (one INCR, one leave, count stuck high),
     * and a client that vanishes without emitting leave:stream at all — which
     * is the common case, since closing a tab fires no application event.
     */
    const joined = new Set<string>();

    async function releaseViewer(streamId: string): Promise<void> {
      if (!joined.delete(streamId)) return;   // never counted; nothing to give back

      // DECR, not get-then-set: two viewers leaving at the same moment both
      // read the same count under the old code, so one departure was lost.
      const next = await redis.decr(REDIS_KEYS.STREAM_VIEWERS(streamId));
      // A negative count means the key expired mid-stream or drifted; clamp
      // rather than broadcasting nonsense.
      if (next < 0) await redis.set(REDIS_KEYS.STREAM_VIEWERS(streamId), 0, { ex: 3600 });
      io.to(`stream:${streamId}`).emit('stream:viewers', { count: Math.max(0, next) });
    }

    // ── join:stream ────────────────────────────────────────────────
    socket.on('join:stream', async (streamId: string) => {
      if (!streamId) return;
      if (joined.has(streamId)) return;       // idempotent: don't double-count

      // Liveness is cached: when a stream goes live, thousands of viewers
      // arrive within seconds of the notification and every one of them
      // would otherwise ask Postgres the same question, whose answer does
      // not change for the duration of the broadcast.
      const isLive = await isStreamLive(streamId);
      if (!isLive) {
        return socket.emit('error', { code: 'STREAM_NOT_LIVE', message: 'Stream not found or not live' });
      }

      socket.join(`stream:${streamId}`);
      joined.add(streamId);

      // One INCR instead of get-then-incr-then-get: three round trips
      // become one, and the count can no longer be wrong under concurrent
      // joins, where two sockets could previously both read the same value.
      const newCount = await redis.incr(REDIS_KEYS.STREAM_VIEWERS(streamId));
      // Give the counter a TTL so an instance lost mid-broadcast cannot leave
      // a permanently inflated count behind for the next stream on this id.
      // Only on the first joiner: INCR created the key, and re-arming the
      // expiry on every subsequent join would double this handler's round
      // trips for thousands of viewers to achieve nothing.
      if (newCount === 1) {
        void redis.expire(REDIS_KEYS.STREAM_VIEWERS(streamId), VIEWER_KEY_TTL_SEC);
      }
      io.to(`stream:${streamId}`).emit('stream:viewers', { count: newCount });

      logger.debug({ userId, streamId }, 'User joined stream room');
    });

    // ── leave:stream ───────────────────────────────────────────────
    socket.on('leave:stream', async (streamId: string) => {
      socket.leave(`stream:${streamId}`);
      await releaseViewer(streamId);
    });

    // ── comment:reply (Premium only) ──────────────────────────────
    socket.on('comment:reply', async (data: {
      streamId: string;
      platformCommentId: string;
      platform: string;
      replyText: string;
    }) => {
      // Delegate to the service rather than calling the platform directly.
      // It owns three things this handler previously skipped: verifying the
      // stream belongs to this user, resolving what the reply is actually
      // addressed to (a YouTube reply targets the liveChatId, not the
      // comment), and recording the reply against the comment row.
      try {
        const { StreamsService } = await import('../modules/streams/streams.service');
        await new StreamsService().replyToComment(userId, data.streamId, {
          platform:  data.platform,
          commentId: data.platformCommentId,
          text:      data.replyText,
        });

        io.to(`stream:${data.streamId}`).emit('comment:reply:sent', {
          platformCommentId: data.platformCommentId,
          platform: data.platform,
          replyText: data.replyText,
        });
      } catch (err) {
        // Pass the real reason through — "reconnect your account" and
        // "you've hit a rate limit" need different action from the user,
        // and a generic failure string hides both.
        const e = err as { statusCode?: number; code?: string; message?: string };
        if (e.code === 'PREMIUM_REQUIRED' || e.statusCode === 402 || e.statusCode === 403) {
          return socket.emit('error', {
            code: 'PREMIUM_REQUIRED',
            message: 'Comment replies are a Premium feature. Upgrade to reply to your audience in real time.',
          });
        }
        socket.emit('comment:reply:failed', {
          platformCommentId: data.platformCommentId,
          code:  e.code ?? 'PLATFORM_REPLY_FAILED',
          error: e.message ?? 'Failed to deliver reply',
        });
      }
    });

    // ── stream:health:ping ─────────────────────────────────────────
    // Frontend sends current measured bitrate every 2s.
    // Server returns a quality recommendation from the adaptive algorithm.
    //
    // The recommendation itself is pure CPU on numbers already in the
    // message, so it answers immediately. What used to make this expensive
    // was persisting the bitrate: one Upstash HTTPS write per ping, per
    // broadcaster, every 2 seconds. A thousand concurrent broadcasters is
    // 500 writes/second for a value nothing reads in real time — enough to
    // blow through an Upstash request quota on its own.
    //
    // So the write is throttled per socket. The stored value is only used
    // for out-of-band inspection (admin views, post-stream summaries), and
    // a 10-second granularity is more than that needs.
    let lastBitrateWriteAt = 0;

    socket.on('stream:health:ping', async (data: { streamId: string; bitrateKbps: number; measuredUploadKbps?: number }) => {
      const kbps       = data.bitrateKbps;
      const uploadKbps = data.measuredUploadKbps ?? kbps * 1.2; // estimate if not provided

      // Answer first — the client is waiting on this to adapt its encoder,
      // and it must not sit behind a network round trip to Redis.
      const recommendation = getAdaptiveRecommendation(kbps, uploadKbps);
      socket.emit('stream:health:status', {
        quality:          recommendation.quality,
        action:           recommendation.action,
        recommended:      recommendation.recommendedLabel,
        targetResolution: recommendation.targetResolution,
        targetBitrateKbps: recommendation.targetBitrateKbps,
        reason:           recommendation.reason,
        bitrateKbps:      kbps,
      });

      const now = Date.now();
      if (now - lastBitrateWriteAt < BITRATE_WRITE_INTERVAL_MS) return;
      lastBitrateWriteAt = now;
      // Not awaited: a slow or degraded cache must not stall the next ping.
      void redis.set(REDIS_KEYS.STREAM_BITRATE(data.streamId), kbps, { ex: 60 });
    });

    // There is deliberately no recording:chunk handler.
    //
    // Recording is produced server-side by the ffmpeg that already feeds the
    // platforms — see broadcast.service, where it is one more slave on the
    // same tee. The browser does not upload anything.
    //
    // What used to be here: the client ran a parallel MediaRecorder and sent
    // every chunk over this socket to be base64'd into a Redis list. That
    // inflated the payload 33%, made one Upstash HTTPS request per chunk with
    // no cap, and re-uploaded video the server was already holding. Nothing
    // ever read the list back, and the "finalised by a BullMQ worker" it
    // referred to does not exist in production — the Dockerfile CMD starts
    // the web process only. So it burned bandwidth and produced no recording.

    // ── disconnect ─────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      // Closing a tab, losing signal, or a dropped heartbeat all land here
      // and never in leave:stream. Without this, every such viewer stays
      // counted forever and the number on the broadcaster's dashboard only
      // ever climbs.
      await Promise.allSettled([...joined].map(releaseViewer));
      logger.debug({ userId, reason }, 'Socket disconnected');
    });
  });

  ioRef = io;
  return io;
}

// ── Broadcast helpers (called from stream service) ─────────────────

export function broadcastComment(io: IO, streamId: string, comment: {
  id: string; platform: string; author: string; platformCommentId: string;
  text: string; timestamp: string;
}): void {
  io.to(`stream:${streamId}`).emit('comment:new', comment);
}

export function broadcastViewerCount(io: IO, streamId: string, count: number): void {
  io.to(`stream:${streamId}`).emit('stream:viewers', { count });
}

export function broadcastStreamEnded(io: IO, streamId: string): void {
  io.to(`stream:${streamId}`).emit('stream:ended', { streamId });
}

export function broadcastPlatformStatus(io: IO, streamId: string, platform: string, status: string): void {
  io.to(`stream:${streamId}`).emit('platform:status', { platform, status });
}
