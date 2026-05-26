import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RecordingsService } from './recordings.service';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess, sendNoContent, paginateMeta } from '../../utils/response';

const svc = new RecordingsService();

const listQuery = z.object({
  page:  z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

const editSchema    = z.object({ prompt: z.string().min(5).max(1000) });
const publishSchema = z.object({
  platform:    z.enum(['youtube','tiktok','instagram','facebook','twitch','twitter','linkedin','kick']),
  caption:     z.string().max(2000).optional(),
  scheduledAt: z.string().datetime().optional(),
});

export async function recordingsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/', {
    schema: { tags: ['Recordings'], summary: 'List recordings', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const q = listQuery.parse(req.query);
    const { data, total } = await svc.list(u.id, q.page, q.limit);
    sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
  });

  fastify.get('/:id', {
    schema: { tags: ['Recordings'], summary: 'Get recording + signed download URL (1h)', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, await svc.get(u.id, req.params.id));
  });

  fastify.delete('/:id', {
    schema: { tags: ['Recordings'], summary: 'Delete recording', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    await svc.delete(u.id, req.params.id);
    sendNoContent(reply);
  });

  fastify.post('/:id/ai-edit', {
    schema: {
      tags: ['Recordings'],
      summary: 'AI video edit by text prompt (Premium)',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['prompt'],
        properties: { prompt: { type: 'string', minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    const { prompt } = editSchema.parse(req.body);
    const { data: profile } = await (await import('../../config/supabase')).supabaseAdmin
      .from('users').select('plan').eq('id', u.id).single();
    sendSuccess(reply, await svc.requestAiEdit(u.id, req.params.id, prompt, profile?.plan ?? 'free'), 'AI edit queued');
  });

  fastify.get('/:id/edit-status', {
    schema: { tags: ['Recordings'], summary: 'Poll AI edit job status', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, await svc.getEditStatus(u.id, req.params.id));
  });

  fastify.post('/:id/publish', {
    schema: {
      tags: ['Recordings'],
      summary: 'Publish recording to a platform',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['platform'],
        properties: {
          platform:    { type: 'string', enum: ['youtube','tiktok','instagram','facebook','twitch','twitter','linkedin','kick'] },
          caption:     { type: 'string' },
          scheduledAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const u = getAuthUser(req);
    const b = publishSchema.parse(req.body);
    await svc.publish(u.id, req.params.id, b.platform, b.caption ?? '', b.scheduledAt);
    sendSuccess(reply, null, 'Publishing queued');
  });
}