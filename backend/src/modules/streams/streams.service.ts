import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { redis, REDIS_KEYS } from '../../config/redis';
import { logger } from '../../config/logger';
import { NotFoundError, AppError, ValidationError, StreamError } from '../../utils/errors';
import { PlatformsService } from '../platforms/platforms.service';
import { createRouter, closeRouter } from '../webrtc/webrtc.service';
import { startBroadcast, stopBroadcast } from '../webrtc/broadcast.service';
import { analyseNetwork, type NetworkTestResult } from './network.service';
import { bufferComment, flushComments } from './comment-buffer';
import type { Platform, StreamStatus } from '../../types/database';

import { PlansService } from '../plans/plans.service';
import { PlatformReplyService } from '../../websocket/platform-reply.service';
import { commentIngestion } from '../../websocket/comment-ingestion.service';
import { getIO, broadcastComment } from '../../websocket/socket';

const platformsSvc = new PlatformsService();
const plansSvc     = new PlansService();
const replySvc     = new PlatformReplyService();

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

    // Enforce plan platform limit and daily stream limit. Resolve the plan
    // once and hand it to both enforcers — they were each re-reading the
    // same users row, and the platform check has to pass before the daily
    // count query is worth issuing.
    const planInfo = await plansSvc.getEffectivePlan(userId);
    await plansSvc.enforcePlatformLimit(userId, payload.platforms, planInfo);
    await plansSvc.enforceDailyStreamLimit(userId, planInfo);

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

    // Independent writes — no reason to await them in series.
    await Promise.all([
      supabaseAdmin.from('streams').update({
        status:              'live',
        mediasoup_router_id: streamId,
        started_at:          new Date().toISOString(),
      }).eq('id', streamId),

      supabaseAdmin.from('recordings').insert({
        id: uuidv4(), stream_id: streamId, user_id: userId, status: 'processing',
      }),
    ]);

    // Fetch decrypted RTMP credentials and notify Go relay
    const platforms = (stream.stream_platforms as { platform: Platform }[]).map(sp => sp.platform);

    // Resolve all platforms concurrently. Each lookup is an independent read
    // and decrypt, so running them in series put up to eight sequential round
    // trips between the user pressing "go live" and the first frame leaving.
    // A failure is captured rather than thrown — one unusable connection
    // should not stop the other seven from going live.
    const resolved = await Promise.all(platforms.map(async (platform) => {
      try {
        return { platform, creds: await platformsSvc.getStreamCredentials(userId, platform) };
      } catch (err) {
        logger.warn({ streamId, platform, err }, 'Skipping platform — credentials unavailable');
        return { platform, creds: null };
      }
    }));

    const creds  = resolved.flatMap(r => (r.creds ? [{ platform: r.platform, ...r.creds }] : []));
    const failed = resolved.filter(r => !r.creds).map(r => r.platform);

    // One statement for every failure, not one per failure.
    if (failed.length) {
      await supabaseAdmin.from('stream_platforms')
        .update({ rtmp_push_status: 'failed' })
        .eq('stream_id', streamId).in('platform', failed);
    }

    // NOTE: we do NOT start pushing to platforms here. At this point the
    // browser has only just received rtpCapabilities — it has not created
    // a transport or produced a single frame, so there is nothing to
    // forward. The frontend calls POST /streams/:id/broadcast once its
    // tracks are live, which is when beginBroadcast() below runs.
    if (creds.length === 0) {
      logger.warn({ streamId }, 'No platform credentials available — stream will be local only');
    }

    return { rtpCapabilities };
  }

  /**
   * Starts the RTP → RTMP push once the browser is actually producing.
   *
   * Split from start() deliberately: mediasoup has no media to consume
   * until the client has created a send transport and called produce(),
   * and consuming a producer that does not exist yet throws.
   */
  async beginBroadcast(userId: string, streamId: string): Promise<{
    platforms: number;
    videoCopied: boolean;
  }> {
    const { data: stream, error } = await supabaseAdmin
      .from('streams').select('title,status,user_id,stream_platforms(platform)')
      .eq('id', streamId).eq('user_id', userId).single();

    if (error || !stream) throw new NotFoundError('Stream');
    if (stream.status !== 'live') {
      throw new StreamError('Stream is not live — call /start first', 'STREAM_NOT_LIVE');
    }

    const platforms = (stream.stream_platforms as { platform: Platform }[]).map(sp => sp.platform);

    type Target = { platform: string; rtmpUrl: string; streamKey: string };
    type Ref    = { platform: string; liveChatId?: string; liveVideoId?: string };

    // Prepare every platform concurrently.
    //
    // openLiveSession is an outbound call to YouTube or Facebook that can
    // take seconds. Run in series, this loop was the longest stretch between
    // the user pressing "go live" and the first frame reaching a platform,
    // and its cost grew linearly with the number of platforms selected —
    // so the users streaming to the most places waited the longest.
    //
    // The two calls stay sequential *within* a platform: openLiveSession can
    // rebind the ingestion key, so the stored credentials are only read once
    // it is known whether a session supplied its own.
    const prepared = await Promise.all(platforms.map(async (
      platform,
    ): Promise<{ platform: string; target: Target | null; ref: Ref | null }> => {
      try {
        // On YouTube this mints the liveBroadcast that viewers actually
        // watch and returns the freshly bound ingestion key, so its
        // credentials supersede the stored ones. Best-effort: a platform
        // with no session concept, or one whose call fails, still receives
        // video via its stored key.
        const session = await platformsSvc.openLiveSession(userId, platform, stream.title ?? 'Live');
        const stored  = await platformsSvc.getStreamCredentials(userId, platform);

        return {
          platform,
          target: {
            platform,
            rtmpUrl:   session?.rtmpUrl   ?? stored.rtmpUrl,
            streamKey: session?.streamKey ?? stored.streamKey,
          },
          ref: (session?.liveChatId || session?.liveVideoId)
            ? { platform, liveChatId: session.liveChatId, liveVideoId: session.liveVideoId }
            : null,
        };
      } catch (err) {
        logger.warn({ streamId, platform, err }, 'Skipping platform — credentials unavailable');
        return { platform, target: null, ref: null };
      }
    }));

    const targets = prepared.flatMap(p => (p.target ? [p.target] : []));
    const refs    = prepared.flatMap(p => (p.ref    ? [p.ref]    : []));
    const failed  = prepared.filter(p => !p.target).map(p => p.platform);

    // Persist the live-session identifiers. Each row takes different values
    // so these cannot collapse into one statement, but they can all be in
    // flight at once instead of blocking the loop one platform at a time.
    await Promise.all([
      ...refs.map(r => supabaseAdmin.from('stream_platforms')
        .update({ live_chat_id: r.liveChatId ?? null, live_video_id: r.liveVideoId ?? null })
        .eq('stream_id', streamId).eq('platform', r.platform)),

      // Same value for every failure, so this is a single statement.
      ...(failed.length
        ? [supabaseAdmin.from('stream_platforms')
            .update({ rtmp_push_status: 'failed' })
            .eq('stream_id', streamId).in('platform', failed)]
        : []),
    ]);

    if (targets.length === 0) {
      throw new StreamError(
        'No platform is connected with valid credentials. Connect a platform in Settings before going live.',
        'NO_PLATFORMS'
      );
    }

    const result = await startBroadcast(streamId, targets);

    await supabaseAdmin.from('stream_platforms')
      .update({ rtmp_push_status: 'active' })
      .eq('stream_id', streamId)
      .in('platform', targets.map(t => t.platform));

    // Comment ingestion is deliberately not awaited into the response path:
    // a chat feed that fails to start must not fail the broadcast, which is
    // already pushing video at this point.
    void this.startComments(streamId, userId, refs);

    logger.info(
      { streamId, platforms: targets.length, videoCopied: result.videoCopied },
      'Broadcast live'
    );

    return result;
  }

  /**
   * Bridges platform chat into the stream's socket room.
   *
   * Each ingested comment is emitted immediately and persisted in the
   * background. The write is what makes replies possible: the frontend
   * addresses a reply by our row id, and the reply service needs the
   * platform's own id plus a reply target to send it back — YouTube replies
   * go to the chat, Facebook replies to the comment. Because the id is
   * generated here rather than by the database, the emit does not have to
   * wait for the insert to know it.
   */
  private async startComments(
    streamId: string,
    userId: string,
    refs: Array<{ platform: string; liveChatId?: string; liveVideoId?: string }>
  ): Promise<void> {
    if (refs.length === 0) return;

    try {
      await commentIngestion.start({
        streamId, userId, platformRefs: refs,
        onComment: (c) => {
          const row = {
            id: uuidv4(), stream_id: streamId, platform: c.platform,
            platform_comment_id: c.id, reply_target: c.replyTarget ?? null,
            author_name: c.author ?? null, author_platform_id: c.authorId ?? null,
            text: c.text, posted_at: c.timestamp,
          };

          // Emit first. A viewer's chat should not lag behind a database
          // write, and the batched writer below deliberately delays.
          const io = getIO();
          if (io) {
            broadcastComment(io, streamId, {
              id: row.id, platform: c.platform, platformCommentId: c.id,
              author: c.author, text: c.text, timestamp: c.timestamp,
            });
          }

          bufferComment(row);
        },
      });
    } catch (err) {
      logger.error({ err, streamId }, 'Comment ingestion failed to start');
    }
  }

  async end(userId: string, streamId: string): Promise<void> {
    const { data: stream } = await supabaseAdmin
      .from('streams').select('status').eq('id', streamId).eq('user_id', userId).single();
    if (!stream) throw new NotFoundError('Stream');
    if (stream.status === 'ended') throw new StreamError('Stream already ended');

    // Order matters: stop the RTMP push before tearing down the router.
    // closeRouter() cascades to the PlainTransports the bridge consumes
    // from, so doing it first would yank the input out from under ffmpeg
    // and platforms would see a dropped connection instead of a clean end.
    await stopBroadcast(streamId);
    commentIngestion.stop(streamId);
    closeRouter(streamId);

    const endedAt = new Date().toISOString();
    // Three independent writes plus the final comment flush. Nothing here
    // reads what another writes, so serialising them only made ending a
    // stream slower. flushComments also drops the stream's buffer, so the
    // map does not accumulate one entry per broadcast for the process's life.
    await Promise.all([
      flushComments(streamId),
      supabaseAdmin.from('streams').update({ status: 'ended', ended_at: endedAt }).eq('id', streamId),
      supabaseAdmin.from('stream_platforms').update({ rtmp_push_status: 'ended' }).eq('stream_id', streamId),
      supabaseAdmin.from('users').update({ last_stream_ended_at: endedAt }).eq('id', userId),
      // The liveness cache would otherwise keep reporting this stream live
      // for up to its TTL, letting viewers join a room nothing emits into.
      redis.del(REDIS_KEYS.STREAM_LIVE(streamId)),
      redis.del(REDIS_KEYS.STREAM_VIEWERS(streamId)),
    ]);

    logger.info({ streamId, userId }, 'Stream ended cleanly');
  }

  /**
   * Network analysis endpoint.
   * The client measures upload throughput, RTT, jitter and loss against
   * /streams/network-upload-test and /streams/ping, then posts the results
   * here to be mapped onto the quality ladder.
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

  /**
   * Posts a reply to a live comment on the platform it came from.
   *
   * Ownership is checked against the stream rather than trusting the
   * client, and the plan gate runs before we spend a platform API call.
   */
  async replyToComment(
    userId: string,
    streamId: string,
    body: { platform: string; commentId: string; text: string }
  ): Promise<{ platform: string; commentId: string }> {
    const { data: stream } = await supabaseAdmin
      .from('streams').select('id,status')
      .eq('id', streamId).eq('user_id', userId).maybeSingle();

    if (!stream) throw new NotFoundError('Stream');

    await plansSvc.enforceCommentReply(userId);

    // Resolve what the reply must actually be addressed to. This is not
    // always the comment id — a YouTube reply is a new message posted into
    // the live chat, so it targets the liveChatId. Passing the comment id
    // there fails every time. The target was recorded at ingestion.
    //
    // Accept either our row id or the platform's own id, since the socket
    // path and the REST path historically sent different ones. Dispatch on
    // shape rather than interpolating the value into an .or() filter —
    // PostgREST parses that string, so an id containing a comma or paren
    // would be read as filter syntax.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      .test(body.commentId);

    const { data: comment } = await supabaseAdmin
      .from('stream_comments')
      .select('id,reply_target,platform_comment_id,platform')
      .eq('stream_id', streamId)
      .eq(isUuid ? 'id' : 'platform_comment_id', body.commentId)
      .maybeSingle();

    const target = comment?.reply_target ?? body.commentId;

    await replySvc.sendReply(userId, body.platform, target, body.text);

    if (comment?.id) {
      await supabaseAdmin.from('stream_comments')
        .update({ replied_at: new Date().toISOString(), reply_text: body.text })
        .eq('id', comment.id);
    }

    logger.info(
      { userId, streamId, platform: body.platform, resolvedTarget: target !== body.commentId },
      'Comment reply posted to platform'
    );

    return { platform: body.platform, commentId: body.commentId };
  }

  /**
   * Recent comments for a stream, newest first.
   *
   * Backfill for a client that joined late or reconnected — the socket only
   * carries comments that arrive while it is listening.
   */
  async listComments(userId: string, streamId: string, limit = 100) {
    const { data: stream } = await supabaseAdmin
      .from('streams').select('id')
      .eq('id', streamId).eq('user_id', userId).maybeSingle();
    if (!stream) throw new NotFoundError('Stream');

    const { data } = await supabaseAdmin
      .from('stream_comments')
      .select('id,platform,platform_comment_id,author_name,text,posted_at,replied_at,reply_text')
      .eq('stream_id', streamId)
      .order('posted_at', { ascending: false })
      .limit(Math.min(limit, 300));

    return (data ?? []).reverse();
  }
}
