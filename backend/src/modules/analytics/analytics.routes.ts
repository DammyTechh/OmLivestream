import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../../config/supabase';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { NotFoundError } from '../../utils/errors';

const dateRange = z.object({
  from: z.string().datetime().default(() => new Date(Date.now() - 30 * 86_400_000).toISOString()),
  to:   z.string().datetime().default(() => new Date().toISOString()),
});

export async function analyticsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/overview', { schema: { tags: ['Analytics'], summary: 'Total views, impressions, engagement (last 30 days)', security: [{ bearerAuth: [] }],
    querystring: { type: 'object', properties: { from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' } } } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req); const { from, to } = dateRange.parse(req.query);

      // Aggregate in Postgres rather than loading every metric row into Node
      // and summing here. A stream emits a metrics row per platform every few
      // seconds, so a month of activity is tens of thousands of rows per user
      // — all of which previously crossed the wire and landed in the Node heap
      // to produce four integers.
      //
      // The function takes the user id and joins to streams itself. It used to
      // take an array of stream ids that this route collected first with
      // `limit(500)`, which meant a heavy account's totals were computed from
      // an arbitrary, unordered 500 of its streams and returned as if complete.
      const { data: agg, error } = await supabaseAdmin
        .rpc('analytics_overview', { p_user_id: u.id, p_from: from, p_to: to });

      if (error) throw error;

      // sum() over a bigint column comes back as a *string* from PostgREST
      // whenever the value could exceed 2^53, so `+=` on it would concatenate
      // ("0" + "123" = "0123") rather than add.
      const rows = (agg ?? []) as Array<{ platform: string; total_views: string | number; total_impressions: string | number; total_comments: string | number }>;
      const byPlatform: Record<string, { views: number; impressions: number; comments: number }> = {};
      let totalViews = 0, totalImpressions = 0, totalComments = 0;
      for (const r of rows) {
        const views = Number(r.total_views), impressions = Number(r.total_impressions), comments = Number(r.total_comments);
        totalViews       += views;
        totalImpressions += impressions;
        totalComments    += comments;
        byPlatform[r.platform] = { views, impressions, comments };
      }
      sendSuccess(reply, { totalViews, totalImpressions, totalComments, byPlatform });
    });

  fastify.get('/platforms', { schema: { tags: ['Analytics'], summary: 'Per-platform breakdown', security: [{ bearerAuth: [] }] } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req); const { from, to } = dateRange.parse(req.query);
      // Columns named rather than '*': user_id is the caller and id is never
      // read by the client. The limit is a ceiling, not paging — this table
      // holds pre-aggregated period rows, so a 30-day window is ~30 rows per
      // platform, and the cap only matters if a caller passes a years-wide
      // range. Without it the response grows without bound.
      const { data } = await supabaseAdmin.from('platform_analytics')
        .select('platform,period,total_views,total_impressions,total_engagement,recorded_at')
        .eq('user_id', u.id).gte('recorded_at', from).lte('recorded_at', to)
        .order('recorded_at', { ascending: false }).limit(2000);
      sendSuccess(reply, data ?? []);
    });

  fastify.get('/streams/:id', { schema: { tags: ['Analytics'], summary: 'Detailed analytics for one stream', security: [{ bearerAuth: [] }] } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const { data: stream } = await supabaseAdmin.from('streams').select('id,title,started_at,ended_at').eq('id', req.params.id).eq('user_id', u.id).single();
      if (!stream) throw new NotFoundError('Stream');
      // Bucket width is chosen from the stream's own duration so the response
      // is bounded by roughly TARGET_POINTS per platform however long the
      // broadcast ran. The previous limit(2000) bounded the *rows* instead: at
      // a sample every few seconds across eight platforms a three-hour stream
      // produces ~17k of them, so the chart silently showed the first twenty
      // minutes as though it were the whole broadcast.
      const TARGET_POINTS = 300;
      const startedAt   = stream.started_at ? new Date(stream.started_at).getTime() : null;
      const endedAt     = stream.ended_at   ? new Date(stream.ended_at).getTime()   : Date.now();
      const durationSec = startedAt ? Math.max(0, (endedAt - startedAt) / 1000) : 0;
      const bucketSeconds = Math.max(5, Math.ceil(durationSec / TARGET_POINTS) || 30);

      const [{ data: metrics, error: mErr }, { data: platforms }] = await Promise.all([
        supabaseAdmin.rpc('stream_metrics_series', {
          p_stream_id: req.params.id, p_bucket_seconds: bucketSeconds,
        }),
        supabaseAdmin.from('stream_platforms')
          .select('platform,rtmp_push_status,viewers_peak,impressions,total_comments')
          .eq('stream_id', req.params.id),
      ]);
      if (mErr) throw mErr;

      // impressions and comments are bigint sums, so they arrive as strings.
      // Field names match the old raw-row shape to keep the response contract.
      const series = ((metrics ?? []) as Array<{
        bucket: string; platform: string; viewers: number;
        impressions: string | number; comments: string | number; bitrate: number;
      }>).map(r => ({
        timestamp:      r.bucket,
        platform:       r.platform,
        viewers:        Number(r.viewers),
        impressions:    Number(r.impressions),
        comments_count: Number(r.comments),
        bitrate_kbps:   Number(r.bitrate),
      }));

      sendSuccess(reply, { stream, metrics: series, platforms: platforms ?? [], bucketSeconds });
    });
}
