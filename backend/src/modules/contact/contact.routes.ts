import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { supabaseAdmin } from '../../config/supabase';
import { authenticateAdmin } from '../../middleware/admin';
import { sendSuccess, sendCreated, paginateMeta } from '../../utils/response';
import { logger } from '../../config/logger';

const contactSchema = z.object({
  name:    z.string().min(2).max(120),
  email:   z.string().email().toLowerCase().trim(),
  message: z.string().min(10).max(4000),
});

const listQuery = z.object({
  page:   z.coerce.number().min(1).default(1),
  limit:  z.coerce.number().min(1).max(100).default(20),
  status: z.enum(['unread','read','replied']).optional(),
});

export async function contactRoutes(fastify: FastifyInstance): Promise<void> {
  // ── PUBLIC: Submit contact form (no auth required) ───────────────
  fastify.post('/', {
    schema: {
      tags: ['Contact'],
      summary: 'Public contact form submission (from landing page)',
      body: {
        type: 'object',
        required: ['name', 'email', 'message'],
        properties: {
          name:    { type: 'string', minLength: 2, maxLength: 120 },
          email:   { type: 'string', format: 'email' },
          message: { type: 'string', minLength: 10, maxLength: 4000 },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const b = contactSchema.parse(req.body);
    const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip;

    const id = uuidv4();
    const { error } = await supabaseAdmin.from('contact_submissions').insert({
      id,
      name:       b.name,
      email:      b.email,
      message:    b.message,
      status:     'unread',
      ip_address: ip,
      created_at: new Date().toISOString(),
    });

    if (error) {
      logger.error({ err: error }, 'Contact submission insert failed');
      throw new Error('Failed to submit message — please try again');
    }

    sendCreated(reply, { id }, 'Thanks — we\'ll get back to you soon.');
  });

  // ── ADMIN: List contact submissions ──────────────────────────────
  fastify.get('/admin/list', {
    preHandler: [authenticateAdmin],
    schema: {
      tags: ['Admin'],
      summary: 'List contact form submissions (admin only)',
      security: [{ bearerAuth: [] }],
      querystring: {
        type: 'object',
        properties: {
          page:   { type: 'integer', default: 1 },
          limit:  { type: 'integer', default: 20 },
          status: { type: 'string', enum: ['unread','read','replied'] },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = listQuery.parse(req.query);
    const from = (q.page - 1) * q.limit;
    const to   = from + q.limit - 1;

    let qb = supabaseAdmin.from('contact_submissions')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (q.status) qb = qb.eq('status', q.status);

    const { data, count } = await qb;
    sendSuccess(reply, data ?? [], undefined, 200, paginateMeta(count ?? 0, q.page, q.limit));
  });

  // ── ADMIN: Mark as read ──────────────────────────────────────────
  fastify.patch('/admin/:id/read', {
    preHandler: [authenticateAdmin],
    schema: { tags: ['Admin'], summary: 'Mark a contact submission as read', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    await supabaseAdmin.from('contact_submissions')
      .update({ status: 'read', read_at: new Date().toISOString() })
      .eq('id', req.params.id);
    sendSuccess(reply, null, 'Marked as read');
  });

  // ── ADMIN: Mark as replied ───────────────────────────────────────
  fastify.patch('/admin/:id/replied', {
    preHandler: [authenticateAdmin],
    schema: { tags: ['Admin'], summary: 'Mark a contact submission as replied', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    await supabaseAdmin.from('contact_submissions')
      .update({ status: 'replied', replied_at: new Date().toISOString() })
      .eq('id', req.params.id);
    sendSuccess(reply, null, 'Marked as replied');
  });

  // ── ADMIN: Delete submission ─────────────────────────────────────
  fastify.delete('/admin/:id', {
    preHandler: [authenticateAdmin],
    schema: { tags: ['Admin'], summary: 'Delete a contact submission', security: [{ bearerAuth: [] }] },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    await supabaseAdmin.from('contact_submissions').delete().eq('id', req.params.id);
    sendSuccess(reply, null, 'Deleted');
  });
}