import axios from 'axios';
import { supabaseAdmin } from '../../config/supabase';
import { redis, REDIS_KEYS } from '../../config/redis';
import { decrypt } from '../../utils/crypto';
import { logger } from '../../config/logger';
import { getIO, broadcastPlatformMetrics } from '../../websocket/socket';

/**
 * Live metrics sampling.
 * ─────────────────────────────────────────────────────────────────
 * `stream_metrics` and `platform_analytics` had a complete read path —
 * schema, indexes, RLS, two aggregation RPCs, three REST routes and two
 * dashboard pages — and nothing anywhere wrote a row to either one. The
 * analytics page papered over it with a Math.random() series, so a feature
 * that could only ever render zeros looked like it was working.
 *
 * This is the missing producer. It samples what the platforms will actually
 * tell us about a live broadcast and writes it down.
 *
 * What is real, and therefore what is recorded:
 *
 *   viewers      Concurrent viewers, read from the platform. YouTube exposes
 *                liveStreamingDetails.concurrentViewers; Facebook exposes
 *                live_views. Both are a *level*, not a total — see the note
 *                on rollUp() and on analytics_overview in v14.
 *   comments     New comments seen since the previous tick, counted by the
 *                ingestion callback. A delta, so summing a range is correct.
 *   bitrate_kbps The encoder's own reported bitrate. Per stream rather than
 *                per platform — one ffmpeg copies one encode to every
 *                target — so the same value lands on each platform's row.
 *
 * What is deliberately absent: impressions. Neither the YouTube Data API nor
 * the Graph API reports impressions for a live broadcast. YouTube has them
 * behind youtubeAnalytics.reports.query, which needs a scope we do not ask
 * for and does not return live data. Rather than write a plausible-looking
 * number into the column, the column stays at its default and the dashboard
 * no longer claims to show it.
 *
 * Platforms other than YouTube and Facebook are not sampled at all. TikTok,
 * Twitch, X, LinkedIn and Kick have no public read for a broadcast we are
 * pushing to over RTMP, and a row of zeros for them would be indistinguishable
 * from a broadcast nobody watched.
 */

/** One live stream's sampling state. */
interface Sampler {
  streamId: string;
  userId:   string;
  timer:    NodeJS.Timeout | null;
  stopped:  boolean;
  /** Per-platform live identifiers and the token to read them with. */
  targets:  SampleTarget[];
  /** Consecutive tick failures, per platform, for backoff and give-up. */
  failures: Map<string, number>;
}

interface SampleTarget {
  platform: string;
  token:    string;
  /**
   * The platform's id for the thing viewers are watching: Facebook's live
   * video, YouTube's liveBroadcast — which is the same id as the video, so
   * one field covers both.
   */
  liveVideoId: string;
}

/** streamId → sampler. */
const samplers = new Map<string, Sampler>();

/**
 * streamId → platform → comments since the last tick.
 *
 * Held here rather than counted with a `select count(*)` per tick: the
 * ingestion callback already sees every comment exactly once, so this is
 * free, and the query it replaces would run once per platform per tick
 * against the busiest table in the schema.
 */
const commentDeltas = new Map<string, Map<string, number>>();

/**
 * How often a live stream is sampled.
 *
 * Not a few seconds. A YouTube videos.list call costs a quota unit, and the
 * value being sampled is a viewer count that moves slowly — sampling it at
 * chat cadence would multiply quota pressure for resolution nobody can see
 * on a chart. Thirty seconds gives 360 points across a three-hour broadcast,
 * which is already finer than the 300-point target the series RPC
 * downsamples to.
 */
const SAMPLE_INTERVAL_MS = 30_000;

/** Give up on a platform after this many consecutive read failures. */
const MAX_FAILURES = 5;

/** Count one ingested comment toward the current sampling window. */
export function noteComment(streamId: string, platform: string): void {
  let forStream = commentDeltas.get(streamId);
  if (!forStream) {
    forStream = new Map();
    commentDeltas.set(streamId, forStream);
  }
  forStream.set(platform, (forStream.get(platform) ?? 0) + 1);
}

/** Read and clear the comment delta for one platform. */
function takeCommentDelta(streamId: string, platform: string): number {
  const forStream = commentDeltas.get(streamId);
  if (!forStream) return 0;
  const n = forStream.get(platform) ?? 0;
  forStream.set(platform, 0);
  return n;
}

async function tokenFor(userId: string, platform: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('platform_connections')
    .select('access_token_encrypted,status')
    .eq('user_id', userId)
    .eq('platform', platform)
    .single();

  if (!data?.access_token_encrypted || data.status !== 'connected') return null;
  try {
    return decrypt(data.access_token_encrypted);
  } catch (err) {
    logger.error({ err, platform }, 'Could not decrypt token for metrics sampling');
    return null;
  }
}

/** Current concurrent viewers on YouTube, or null if the API did not say. */
async function youtubeViewers(token: string, broadcastId: string): Promise<number | null> {
  const { data } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    headers: { Authorization: `Bearer ${token}` },
    params:  { part: 'liveStreamingDetails', id: broadcastId },
    timeout: 10_000,
  });
  // Absent once the broadcast ends, and absent for a broadcast that has not
  // started receiving video. Both are "no reading", not "zero viewers".
  const raw = data?.items?.[0]?.liveStreamingDetails?.concurrentViewers;
  return raw === undefined || raw === null ? null : Number(raw);
}

/** Current concurrent viewers on Facebook, or null. */
async function facebookViewers(token: string, liveVideoId: string): Promise<number | null> {
  const { data } = await axios.get(`https://graph.facebook.com/v19.0/${liveVideoId}`, {
    params:  { access_token: token, fields: 'live_views' },
    timeout: 10_000,
  });
  const raw = data?.live_views;
  return raw === undefined || raw === null ? null : Number(raw);
}

/**
 * The platform's own total view count for a finished broadcast.
 *
 * This is the one honest "total views" number available, and it is only
 * available after the fact — which is why it is collected at rollup rather
 * than sampled. Returns null when the platform does not report one, and the
 * caller then writes no row rather than substituting something else.
 */
async function totalViews(target: SampleTarget): Promise<number | null> {
  try {
    if (target.platform === 'youtube') {
      const { data } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
        headers: { Authorization: `Bearer ${target.token}` },
        params:  { part: 'statistics', id: target.liveVideoId },
        timeout: 10_000,
      });
      const raw = data?.items?.[0]?.statistics?.viewCount;
      return raw === undefined ? null : Number(raw);
    }

    if (target.platform === 'facebook') {
      // The live video node has no total-views field of its own; the count
      // lives on the underlying Video node it wraps.
      const { data } = await axios.get(`https://graph.facebook.com/v19.0/${target.liveVideoId}`, {
        params:  { access_token: target.token, fields: 'video{views}' },
        timeout: 10_000,
      });
      const raw = data?.video?.views;
      return raw === undefined ? null : Number(raw);
    }
  } catch (err) {
    logger.warn(
      { err: (err as { response?: { data?: unknown } })?.response?.data ?? err, platform: target.platform },
      'Could not read total views — no analytics row for this platform',
    );
  }
  return null;
}

/**
 * Begin sampling a live stream.
 *
 * `refs` are the live-session identifiers captured when the broadcast
 * started. A platform without one is skipped: there is nothing to read.
 * Best-effort throughout — a stream that cannot be measured must still
 * broadcast.
 */
export async function startSampling(params: {
  streamId: string;
  userId:   string;
  refs:     Array<{ platform: string; liveVideoId?: string }>;
}): Promise<void> {
  const { streamId, userId, refs } = params;

  const targets: SampleTarget[] = [];
  for (const ref of refs) {
    // live_video_id is the platform's id for what is being watched — for
    // Facebook the live video, for YouTube the liveBroadcast, whose id is
    // the same as its video's. It is populated by goLive for every platform
    // that opened a session; a platform without one has nothing to read.
    if (ref.platform !== 'youtube' && ref.platform !== 'facebook') continue;
    if (!ref.liveVideoId) continue;

    const token = await tokenFor(userId, ref.platform);
    if (!token) continue;

    targets.push({ platform: ref.platform, token, liveVideoId: ref.liveVideoId });
  }

  if (targets.length === 0) {
    logger.info({ streamId }, 'No readable platform — not sampling metrics');
    return;
  }

  // Replace rather than stack, so a restarted broadcast does not leave the
  // previous run's timer writing rows for the same stream.
  const existing = samplers.get(streamId);
  if (existing) stopSamplerObject(existing);

  const sampler: Sampler = {
    streamId, userId, timer: null, stopped: false,
    targets, failures: new Map(),
  };
  samplers.set(streamId, sampler);
  commentDeltas.set(streamId, new Map());

  logger.info(
    { streamId, platforms: targets.map(t => t.platform) },
    'Metrics sampling started',
  );

  // First sample immediately so a short stream still records something, then
  // on the interval. setTimeout rather than setInterval, so a slow round of
  // platform reads can never overlap the next one.
  void tick(sampler);
}

async function tick(sampler: Sampler): Promise<void> {
  if (sampler.stopped) return;

  const { streamId } = sampler;
  const timestamp = new Date().toISOString();

  // One encoder, one bitrate. The health ping writes this every 10s with a
  // 60s expiry, so a missing key means the broadcaster's client is not
  // reporting — recorded as 0 rather than guessed.
  const bitrateRaw  = await redis.get<number | string>(REDIS_KEYS.STREAM_BITRATE(streamId));
  const bitrateKbps = Math.round(Number(bitrateRaw) || 0);

  const rows: Array<{
    stream_id: string; platform: string; timestamp: string;
    viewers: number; comments_count: number; bitrate_kbps: number;
  }> = [];

  // Platforms are read concurrently: two sequential HTTP calls would put the
  // slower platform's latency into the sampling interval.
  await Promise.all(sampler.targets.map(async (target) => {
    try {
      const viewers = target.platform === 'youtube'
        ? await youtubeViewers(target.token, target.liveVideoId)
        : await facebookViewers(target.token, target.liveVideoId);

      sampler.failures.set(target.platform, 0);

      // A platform that returned no reading contributes no row. Writing 0
      // would be indistinguishable from an empty audience, and averaging it
      // into the chart would drag a real viewer count down.
      if (viewers === null) return;

      rows.push({
        stream_id:      streamId,
        platform:       target.platform,
        timestamp,
        viewers,
        comments_count: takeCommentDelta(streamId, target.platform),
        bitrate_kbps:   bitrateKbps,
      });
    } catch (err) {
      const n = (sampler.failures.get(target.platform) ?? 0) + 1;
      sampler.failures.set(target.platform, n);
      const status = (err as { response?: { status?: number } })?.response?.status;

      // A rejected token will not start working mid-broadcast.
      if (status === 401 || status === 403 || n >= MAX_FAILURES) {
        logger.warn(
          { streamId, platform: target.platform, status, failures: n },
          'Dropping platform from metrics sampling',
        );
        sampler.targets = sampler.targets.filter(t => t.platform !== target.platform);
      } else {
        logger.debug({ err, streamId, platform: target.platform }, 'Metrics sample failed');
      }
    }
  }));

  if (rows.length) {
    const { error } = await supabaseAdmin.from('stream_metrics').insert(rows);
    if (error) logger.warn({ err: error, streamId }, 'Could not write stream metrics');
    else await updatePeaks(streamId, rows);

    // Push the viewer readings to whoever is watching the stream page. Sent
    // after the insert so the socket cannot report a sample that failed to
    // persist, and only for platforms that returned a reading — see the
    // note on broadcastPlatformMetrics.
    const io = getIO();
    if (io) {
      const viewersByPlatform: Record<string, number> = {};
      for (const row of rows) viewersByPlatform[row.platform] = row.viewers;
      broadcastPlatformMetrics(io, streamId, viewersByPlatform);
    }
  }

  // Every platform gave up: keep the sampler object so stop() stays simple,
  // but stop burning a timer on it.
  if (sampler.targets.length === 0) {
    logger.info({ streamId }, 'No platform left to sample — stopping');
    return stopSamplerObject(sampler);
  }

  if (sampler.stopped) return;
  sampler.timer = setTimeout(() => void tick(sampler), SAMPLE_INTERVAL_MS);
}

/**
 * Keep stream_platforms' running counters current.
 *
 * These three columns were initialised to 0 when the stream was created and
 * never touched again, so the per-stream analytics view reported zero for
 * every platform of every broadcast ever run. They are maintained here
 * because this is the only place that knows a new sample arrived.
 *
 * Peak is a running max, not the latest sample: "viewers_peak" is the whole
 * point of the column, and overwriting it with the current level would make
 * it read as "viewers at the moment the stream ended", which is close to
 * zero for every stream that ends normally.
 */
async function updatePeaks(
  streamId: string,
  rows: Array<{ platform: string; viewers: number; comments_count: number }>,
): Promise<void> {
  const { data: current } = await supabaseAdmin
    .from('stream_platforms')
    .select('platform,viewers_peak,total_comments')
    .eq('stream_id', streamId);

  const byPlatform = new Map((current ?? []).map(r => [r.platform, r]));

  await Promise.all(rows.map(async (row) => {
    const existing = byPlatform.get(row.platform);
    if (!existing) return;

    const peak     = Math.max(existing.viewers_peak ?? 0, row.viewers);
    const comments = (existing.total_comments ?? 0) + row.comments_count;
    if (peak === existing.viewers_peak && comments === existing.total_comments) return;

    await supabaseAdmin.from('stream_platforms')
      .update({ viewers_peak: peak, total_comments: comments })
      .eq('stream_id', streamId).eq('platform', row.platform);
  }));
}

/**
 * Write the day's rollup for a finished stream.
 *
 * Called on stream end, once, per platform. `platform_analytics` is the
 * table the dashboard's charts read, and it stores exactly one honest
 * number: the platform's own total view count for the broadcast.
 *
 * A platform that does not report one gets no row rather than a row derived
 * from something else. Mixing "total views as YouTube counts them" with
 * "peak concurrent viewers, because that is all we could get" in a single
 * column labelled Total views is the sort of quietly wrong number that is
 * worse than a gap: the gap is visible.
 *
 * Rows are keyed by (user, platform, period, day) so a user who streams
 * three times in a day accumulates into one daily row instead of three. The
 * accumulation happens inside rollup_platform_analytics (v14) rather than
 * here: doing it as select-then-update meant two streams ending in the same
 * second could both read "no row yet", and one of the two broadcasts' views
 * would be lost to the unique index.
 */
async function rollUp(sampler: Sampler): Promise<void> {
  const { streamId, userId } = sampler;
  const day = new Date().toISOString();

  await Promise.all(sampler.targets.map(async (target) => {
    const views = await totalViews(target);
    if (views === null) return;

    const { data: comments } = await supabaseAdmin
      .from('stream_platforms')
      .select('total_comments')
      .eq('stream_id', streamId).eq('platform', target.platform)
      .maybeSingle();

    // No impressions argument: no source for one on either live API — see
    // the file header. The column keeps its default rather than a guess.
    const { error } = await supabaseAdmin.rpc('rollup_platform_analytics', {
      p_user_id:    userId,
      p_platform:   target.platform,
      p_day:        day,
      p_views:      views,
      p_engagement: comments?.total_comments ?? 0,
    });

    if (error) logger.warn({ err: error, streamId, platform: target.platform }, 'Analytics rollup failed');
  }));
}

/**
 * Fold the trailing partial window's comments into stream_platforms.
 *
 * Every tick clears the delta as it writes it. Whatever is left when the
 * stream ends never made it into a metrics row, so it is added straight to
 * the per-platform total — which is what the rollup reads a moment later.
 */
async function flushPendingComments(sampler: Sampler): Promise<void> {
  const pending = commentDeltas.get(sampler.streamId);
  if (!pending) return;

  const outstanding = [...pending.entries()].filter(([, n]) => n > 0);
  if (outstanding.length === 0) return;

  const rows = outstanding.map(([platform, comments_count]) => ({
    platform, viewers: 0, comments_count,
  }));
  // viewers: 0 is safe here because updatePeaks takes a running max — it can
  // only ever leave an existing peak unchanged.
  await updatePeaks(sampler.streamId, rows);
}

function stopSamplerObject(sampler: Sampler): void {
  sampler.stopped = true;
  if (sampler.timer) clearTimeout(sampler.timer);
  sampler.timer = null;
  samplers.delete(sampler.streamId);
  commentDeltas.delete(sampler.streamId);
}

/**
 * Stop sampling a stream and record its rollup.
 *
 * The rollup runs before the sampler is discarded because it needs the
 * tokens and live identifiers the sampler is holding — by the time the
 * stream row says 'ended', YouTube's broadcast is closed and Facebook's
 * live video has become an ordinary video, but both are still addressable
 * by the ids captured at go-live.
 *
 * Safe to call for a stream that was never sampled.
 */
export async function stopSampling(streamId: string): Promise<void> {
  const sampler = samplers.get(streamId);
  if (!sampler) return;

  // Stop the timer first: a tick that fires during the rollup would write a
  // metrics row for a broadcast that has already ended.
  sampler.stopped = true;
  if (sampler.timer) clearTimeout(sampler.timer);
  sampler.timer = null;

  // Comments that arrived since the last tick belong to this stream's totals.
  // Without this they are dropped, and a stream shorter than one sampling
  // interval would report no comments at all.
  await flushPendingComments(sampler);

  try {
    await rollUp(sampler);
  } catch (err) {
    logger.error({ err, streamId }, 'Analytics rollup threw');
  }

  stopSamplerObject(sampler);
  logger.info({ streamId }, 'Metrics sampling stopped');
}

/**
 * Stop every sampler without rolling up — for process shutdown.
 *
 * Deliberately skips the rollup: shutdown is already waiting on ffmpeg and
 * the comment flush, and this one would add two outbound HTTPS calls per
 * platform per live stream to that budget. The metrics rows already written
 * survive, and the stream's own end() will roll up when it runs.
 */
export function stopAllSampling(): void {
  for (const sampler of [...samplers.values()]) stopSamplerObject(sampler);
}
