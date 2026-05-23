import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { NotFoundError, AppError, ValidationError, StreamError } from '../../utils/errors';
import { PlatformsService } from '../platforms/platforms.service';
import { createRouter, closeRouter } from '../webrtc/webrtc.service';
import { analyseNetwork, type NetworkTestResult } from './network.service';
import type { Platform, StreamStatus } from '../../types/database';

import { PlansService } from '../plans/plans.service';

const platformsSvc = new PlatformsService();
const plansSvc     = new PlansService();

export class StreamsService {

  async list(userId: string, page = 1, limit = 20, status?: StreamStatus) {
    let q = supabaseAdmin
      .from('streams').select('*,stream_platforms(*)', { count: 'exact' })
      .eq('user_id', userId).order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (status) q = q.eq('status', status);
    const { data, error, count } = await q;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async get(userId: string, streamId: string) {
    const { data, error } = await supabaseAdmin
      .from('streams').select('*,stream_platforms(*),recordings(*)')
      .eq('id', streamId).eq('user_id', userId).single();
    if (error || !data) throw new NotFoundError('Stream');
    return data;
  }

  async create(userId: string, payload: {
    title: string; description?: string; thumbnailUrl?: string; platforms: Platform[];
  }) {
    if (!payload.platforms.length) throw new ValidationError('Select at least one platform to stream to');
    if (payload.platforms.length > 8) throw new ValidationError('Maximum 8 platforms per stream');

    // Enforce plan platform limit and daily stream limit
    await plansSvc.enforcePlatformLimit(userId, payload.platforms);
    await plansSvc.enforceDailyStreamLimit(userId);

    const { data: stream, error } = await supabaseAdmin.from('streams').insert({
      id: uuidv4(), user_id: userId,
      title:         payload.title,
      description:   payload.description ?? null,
      thumbnail_url: payload.thumbnailUrl ?? null,
      status:        'scheduled',
    }).select('*').single();

    if (error || !stream) throw error ?? new AppError('Failed to create stream');

    await supabaseAdmin.from('stream_platforms').insert(
      payload.platforms.map(p => ({
        id: uuidv4(), stream_id: stream.id, platform: p,
        rtmp_push_status: 'pending', viewers_peak: 0, impressions: 0, total_comments: 0,
      }))
    );

    return stream;
  }

  async start(userId: string, streamId: string): Promise<{ rtpCapabilities: object }> {
    const { data: stream, error } = await supabaseAdmin
      .from('streams').select('*,stream_platforms(platform)')
      .eq('id', streamId).eq('user_id', userId).single();

    if (error || !stream) throw new NotFoundError('Stream');
    if (stream.status === 'live')  throw new StreamError('Stream is already live', 'STREAM_ALREADY_LIVE');
    if (stream.status === 'ended') throw new StreamError('Stream has already ended — create a new one', 'STREAM_ENDED');

    // Create mediasoup Router (pure SFU — zero transcoding, max quality)
    const rtpCapabilities = await createRouter(streamId);

    await supabaseAdmin.from('streams').update({
      status:              'live',
      mediasoup_router_id: streamId,
      started_at:          new Date().toISOString(),
    }).eq('id', streamId);

    // Create recording row
    await supabaseAdmin.from('recordings').insert({
      id: uuidv4(), stream_id: streamId, user_id: userId, status: 'processing',
    });

    // Fetch decrypted RTMP credentials and notify Go relay
    const platforms = (stream.stream_platforms as { platform: Platform }[]).map(sp => sp.platform);
    const creds: { platform: string; rtmpUrl: string; streamKey: string }[] = [];

    for (const platform of platforms) {
      try {
        const c = await platformsSvc.getStreamCredentials(userId, platform);
        creds.push({ platform, ...c });
      } catch (err) {
        logger.warn({ streamId, platform, err }, 'Skipping platform — credentials unavailable');
        await supabaseAdmin.from('stream_platforms')
          .update({ rtmp_push_status: 'failed' })
          .eq('stream_id', streamId).eq('platform', platform);
      }
    }

    if (creds.length > 0) {
      try {
        await axios.post(
          `${env.RTMP_RELAY_INTERNAL_URL}/relay/start`,
          { streamId, platforms: creds },
          { headers: { 'X-Relay-Secret': env.RTMP_RELAY_SECRET }, timeout: 5000 }
        );
        await supabaseAdmin.from('stream_platforms')
          .update({ rtmp_push_status: 'active' })
          .eq('stream_id', streamId)
          .in('platform', creds.map(c => c.platform));
        logger.info({ streamId, count: creds.length }, 'RTMP relay started');
      } catch (err) {
        logger.error({ streamId, err }, 'RTMP relay unreachable — stream continues without relay');
      }
    }

    return { rtpCapabilities };
  }

  async end(userId: string, streamId: string): Promise<void> {
    const { data: stream } = await supabaseAdmin
      .from('streams').select('status').eq('id', streamId).eq('user_id', userId).single();
    if (!stream) throw new NotFoundError('Stream');
    if (stream.status === 'ended') throw new StreamError('Stream already ended');

    closeRouter(streamId);

    try {
      await axios.post(
        `${env.RTMP_RELAY_INTERNAL_URL}/relay/stop`,
        { streamId },
        { headers: { 'X-Relay-Secret': env.RTMP_RELAY_SECRET }, timeout: 5000 }
      );
    } catch { /* relay may already be down */ }

    const endedAt = new Date().toISOString();
    await supabaseAdmin.from('streams').update({ status: 'ended', ended_at: endedAt }).eq('id', streamId);
    await supabaseAdmin.from('stream_platforms').update({ rtmp_push_status: 'ended' }).eq('stream_id', streamId);
    await supabaseAdmin.from('users').update({ last_stream_ended_at: endedAt }).eq('id', userId);

    logger.info({ streamId, userId }, 'Stream ended cleanly');
  }

  /**
   * Network analysis endpoint.
   * Frontend measures upload speed, latency, jitter, and packet loss using
   * navigator.connection + a timed test upload to /streams/network-test-upload
   * then posts the results here for server-side analysis.
   */
  analyseNetwork(params: {
    uploadMbps:        number;
    latencyMs:         number;
    jitterMs:          number;
    packetLossPercent: number;
    selectedPlatforms: string[];
  }): NetworkTestResult {
    return analyseNetwork(params);
  }
}
