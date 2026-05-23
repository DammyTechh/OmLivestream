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
      const { data: userStreams } = await supabaseAdmin.from('streams').select('id').eq('user_id', u.id);
      const streamIds = userStreams?.map(s => s.id) ?? [];

      if (!streamIds.length) return sendSuccess(reply, { totalViews: 0, totalImpressions: 0, totalComments: 0, byPlatform: {} });

      const { data: metrics } = await supabaseAdmin.from('stream_metrics')
        .select('viewers,impressions,comments_count,platform')
        .in('stream_id', streamIds).gte('timestamp', from).lte('timestamp', to);

      const byPlatform: Record<string, { views: number; impressions: number; comments: number }> = {};
      let totalViews = 0, totalImpressions = 0, totalComments = 0;
      for (const m of metrics ?? []) {
        totalViews       += m.viewers;
        totalImpressions += m.impressions;
        totalComments    += m.comments_count;
        if (!byPlatform[m.platform]) byPlatform[m.platform] = { views: 0, impressions: 0, comments: 0 };
        byPlatform[m.platform].views       += m.viewers;
        byPlatform[m.platform].impressions += m.impressions;
        byPlatform[m.platform].comments    += m.comments_count;
      }
      sendSuccess(reply, { totalViews, totalImpressions, totalComments, byPlatform });
    });

  fastify.get('/platforms', { schema: { tags: ['Analytics'], summary: 'Per-platform breakdown', security: [{ bearerAuth: [] }] } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req); const { from, to } = dateRange.parse(req.query);
      const { data } = await supabaseAdmin.from('platform_analytics')
        .select('*').eq('user_id', u.id).gte('recorded_at', from).lte('recorded_at', to)
        .order('recorded_at', { ascending: false });
      sendSuccess(reply, data ?? []);
    });

  fastify.get('/streams/:id', { schema: { tags: ['Analytics'], summary: 'Detailed analytics for one stream', security: [{ bearerAuth: [] }] } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const { data: stream } = await supabaseAdmin.from('streams').select('id,title,started_at,ended_at').eq('id', req.params.id).eq('user_id', u.id).single();
      if (!stream) throw new NotFoundError('Stream');
      const [{ data: metrics }, { data: platforms }] = await Promise.all([
        supabaseAdmin.from('stream_metrics').select('*').eq('stream_id', req.params.id).order('timestamp', { ascending: true }),
        supabaseAdmin.from('stream_platforms').select('*').eq('stream_id', req.params.id),
      ]);
      sendSuccess(reply, { stream, metrics: metrics ?? [], platforms: platforms ?? [] });
    });
}
