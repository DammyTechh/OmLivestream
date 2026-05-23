import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { WaitlistService } from './waitlist.service';
import { authenticate } from '../../middleware/auth';
import { authenticateAdmin } from '../../middleware/admin';
import { sendSuccess, paginateMeta } from '../../utils/response';

const waitlistSvc = new WaitlistService();

const joinSchema = z.object({
  email:  z.string().email('Valid email required').toLowerCase().trim(),
  source: z.string().max(100).optional(),
});

export async function waitlistRoutes(fastify: FastifyInstance): Promise<void> {

  /**
   * POST /waitlist/join  — PUBLIC (no auth needed)
   * Called from the landing page / getform webhook or directly.
   * Also callable from the app for logged-out visitors.
   */
  fastify.post('/join', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } }, // stricter rate limit
    schema: {
      tags: ['Waitlist'],
      summary: 'Join the OmliveStream waitlist — public endpoint',
      description: `
No authentication required. Call from the landing page form.

On success:
- User is added to the waitlist
- Confirmation email sent with the full offer:
  🎁 1 Month FREE trial extension
  💸 50% off first 6 months
  🔥 Full premium access during trial

When they register, the reward is automatically applied.
      `.trim(),
      body: {
        type: 'object', required: ['email'],
        properties: {
          email:  { type: 'string', format: 'email' },
          source: { type: 'string', description: 'Traffic source (optional)', example: 'landing-page' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body   = joinSchema.parse(req.body);
    const result = await waitlistSvc.join({
      email:    body.email,
      source:   body.source,
      ip:       req.ip,
      metadata: req.body as Record<string, string>,
    });
    sendSuccess(reply, result);
  });

  /**
   * GET /waitlist/status?email=...  — PUBLIC
   * Lets users check if they are on the waitlist.
   */
  fastify.get('/status', {
    schema: {
      tags: ['Waitlist'],
      summary: 'Check if an email is on the waitlist',
      querystring: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } },
    },
  }, async (req: FastifyRequest<{ Querystring: { email: string } }>, reply: FastifyReply) => {
    const email = req.query.email.toLowerCase().trim();
    const { data } = await (await import('../../config/supabase')).supabaseAdmin
      .from('waitlist')
      .select('reward_granted, converted_user_id')
      .eq('email', email)
      .maybeSingle();

    sendSuccess(reply, {
      onWaitlist:    !!data,
      rewardGranted: data?.reward_granted ?? false,
      converted:     !!data?.converted_user_id,
    });
  });

  // ── Admin waitlist endpoints (require admin JWT) ───────────────

  fastify.register(async (adminRoutes) => {
    adminRoutes.addHook('preHandler', authenticateAdmin);

    adminRoutes.get('/admin/list', {
      schema: {
        tags: ['Waitlist'],
        summary: 'Admin — list all waitlist signups',
        security: [{ bearerAuth: [] }],
        querystring: { type: 'object', properties: {
          page:      { type: 'integer', default: 1 },
          limit:     { type: 'integer', default: 50 },
          converted: { type: 'boolean', description: 'Filter by conversion status' },
        }},
      },
    }, async (req: FastifyRequest<{ Querystring: { page?: number; limit?: number; converted?: boolean } }>, reply) => {
      const { page = 1, limit = 50, converted } = req.query;
      const { data, total } = await waitlistSvc.listWaitlist({ page, limit, converted });
      sendSuccess(reply, data, undefined, 200, paginateMeta(total, page, limit));
    });

    adminRoutes.get('/admin/stats', {
      schema: {
        tags: ['Waitlist'],
        summary: 'Admin — waitlist stats: total, converted, pending, conversion rate',
        security: [{ bearerAuth: [] }],
      },
    }, async (_req, reply) => {
      sendSuccess(reply, await waitlistSvc.getWaitlistStats());
    });
  });
}
