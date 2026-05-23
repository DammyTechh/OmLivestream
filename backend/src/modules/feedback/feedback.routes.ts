import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../../config/supabase';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { EmailService } from '../email/email.service';

const emailService = new EmailService();
const feedbackSchema = z.object({ message: z.string().min(5).max(2000), rating: z.number().int().min(1).max(5) });

export async function feedbackRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  fastify.post('/', { schema: { tags: ['Feedback'], summary: 'Submit feedback', security: [{ bearerAuth: [] }],
    body: { type: 'object', required: ['message','rating'], properties: { message: { type: 'string', minLength: 5, maxLength: 2000 }, rating: { type: 'integer', minimum: 1, maximum: 5 } } } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req); const b = feedbackSchema.parse(req.body);
      await supabaseAdmin.from('feedback').insert({ id: uuidv4(), user_id: u.id, message: b.message, rating: b.rating as 1 | 2 | 3 | 4 | 5 });
      const { data: p } = await supabaseAdmin.from('users').select('email').eq('id', u.id).single();
      if (p) await emailService.sendFeedbackConfirmation(p.email);
      sendSuccess(reply, null, 'Feedback received — thank you!');
    });

  fastify.get('/feature-updates', { schema: { tags: ['Feedback'], summary: 'Latest feature updates with read status', security: [{ bearerAuth: [] }] } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const u = getAuthUser(req);
      const [{ data: updates }, { data: reads }] = await Promise.all([
        supabaseAdmin.from('feature_updates').select('*').order('published_at', { ascending: false }).limit(20),
        supabaseAdmin.from('user_feature_reads').select('feature_update_id').eq('user_id', u.id),
      ]);
      const readSet = new Set(reads?.map(r => r.feature_update_id) ?? []);
      sendSuccess(reply, (updates ?? []).map(u => ({ ...u, is_read: readSet.has(u.id) })));
    });

  fastify.post('/feature-updates/:id/mark-read', { schema: { tags: ['Feedback'], summary: 'Mark feature update as read', security: [{ bearerAuth: [] }] } },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const u = getAuthUser(req);
      await supabaseAdmin.from('user_feature_reads').upsert(
        { user_id: u.id, feature_update_id: req.params.id, read_at: new Date().toISOString() },
        { onConflict: 'user_id,feature_update_id' }
      );
      sendSuccess(reply, null, 'Marked as read');
    });
}
