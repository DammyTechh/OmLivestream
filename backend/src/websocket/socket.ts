import { Server as IO, Socket } from 'socket.io';
import http from 'http';
import jwt from 'jsonwebtoken';
import { env, corsAllowedOrigins } from '../config/env';
import { redis, REDIS_KEYS } from '../config/redis';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../config/logger';
import { PlatformReplyService } from './platform-reply.service';
import type { JwtPayload } from '../types/database';

type AuthSocket = Socket & { userId: string; userPlan: string };

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

    // ── join:stream ────────────────────────────────────────────────
    socket.on('join:stream', async (streamId: string) => {
      if (!streamId) return;
      const { data: stream } = await supabaseAdmin
        .from('streams').select('id,status,user_id').eq('id', streamId).single();

      if (!stream || stream.status !== 'live') {
        return socket.emit('error', { code: 'STREAM_NOT_LIVE', message: 'Stream not found or not live' });
      }
      socket.join(`stream:${streamId}`);

      // Send current viewer count
      const viewers = parseInt((await redis.get(REDIS_KEYS.STREAM_VIEWERS(streamId))) ?? '0', 10);
      socket.emit('stream:viewers', { count: viewers });

      // Increment viewer count
      await redis.incr(REDIS_KEYS.STREAM_VIEWERS(streamId));
      const newCount = parseInt((await redis.get(REDIS_KEYS.STREAM_VIEWERS(streamId))) ?? '1', 10);
      io.to(`stream:${streamId}`).emit('stream:viewers', { count: newCount });

      logger.debug({ userId, streamId }, 'User joined stream room');
    });

    // ── leave:stream ───────────────────────────────────────────────
    socket.on('leave:stream', async (streamId: string) => {
      socket.leave(`stream:${streamId}`);
      const cur = parseInt((await redis.get(REDIS_KEYS.STREAM_VIEWERS(streamId))) ?? '1', 10);
      const next = Math.max(0, cur - 1);
      await redis.set(REDIS_KEYS.STREAM_VIEWERS(streamId), next, { ex: 3600 });
      io.to(`stream:${streamId}`).emit('stream:viewers', { count: next });
    });

    // ── comment:reply (Premium only) ──────────────────────────────
    socket.on('comment:reply', async (data: {
      streamId: string;
      platformCommentId: string;
      platform: string;
      replyText: string;
    }) => {
      // Check via plan service — respects free_trial, free, premium
      try {
        const { PlansService } = await import('../modules/plans/plans.service');
        await new PlansService().enforceCommentReply(userId);
      } catch {
        return socket.emit('error', {
          code: 'PREMIUM_REQUIRED',
          message: 'Comment replies are a Premium feature. Upgrade to reply to your audience in real time.',
        });
      }
      try {
        const replySvc = new PlatformReplyService();
        await replySvc.sendReply(userId, data.platform, data.platformCommentId, data.replyText);
        io.to(`stream:${data.streamId}`).emit('comment:reply:sent', {
          platformCommentId: data.platformCommentId,
          platform: data.platform,
          replyText: data.replyText,
        });
      } catch {
        socket.emit('comment:reply:failed', { platformCommentId: data.platformCommentId, error: 'Failed to deliver reply' });
      }
    });

    // ── stream:health:ping ─────────────────────────────────────────
    // Frontend sends current measured bitrate every 2s.
    // Server uses adaptive algorithm to return quality recommendation.
    socket.on('stream:health:ping', async (data: { streamId: string; bitrateKbps: number; measuredUploadKbps?: number }) => {
      const kbps         = data.bitrateKbps;
      const uploadKbps   = data.measuredUploadKbps ?? kbps * 1.2; // estimate if not provided
      await redis.set(REDIS_KEYS.STREAM_BITRATE(data.streamId), kbps, { ex: 30 });

      // Use real adaptive network algorithm
      const { getAdaptiveRecommendation } = await import('../modules/streams/network.service');
      const recommendation = getAdaptiveRecommendation(kbps, uploadKbps);

      socket.emit('stream:health:status', {
        quality:         recommendation.quality,
        action:          recommendation.action,
        recommended:     recommendation.recommendedLabel,
        targetResolution: recommendation.targetResolution,
        targetBitrateKbps: recommendation.targetBitrateKbps,
        reason:          recommendation.reason,
        bitrateKbps:     kbps,
      });
    });

    // ── recording:chunk ───────────────────────────────────────────
    // Receives binary recording chunks from the browser MediaRecorder
    socket.on('recording:chunk', async (data: { streamId: string; chunk: Buffer; index: number }) => {
      // Store chunk in Redis list temporarily; finalised by BullMQ worker when stream ends
      await redis.rpush(`recording:chunks:${data.streamId}`, data.chunk.toString('base64'));
    });

    // ── disconnect ─────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.debug({ userId, reason }, 'Socket disconnected');
    });
  });

  return io;
}

// ── Broadcast helpers (called from stream service) ─────────────────

export function broadcastComment(io: IO, streamId: string, comment: {
  id: string; platform: string; platformCommentId: string;
  username: string; avatarUrl?: string; text: string; timestamp: string;
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
