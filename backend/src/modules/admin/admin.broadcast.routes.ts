import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticateAdmin, getAdminUser, requireRole } from '../../middleware/admin';
import { AdminBroadcastService, type BroadcastSegment } from './admin.broadcast.service';
import { sendSuccess, sendCreated, sendNoContent, paginateMeta } from '../../utils/response';

const svc = new AdminBroadcastService();

const SEGMENTS: [BroadcastSegment, ...BroadcastSegment[]] = [
  'all', 'free_trial', 'free', 'premium', 'waitlist_members', 'inactive',
];

const TAG = 'Admin Broadcasts';
const AUTH = [{ bearerAuth: [] }];

// ── Schemas ────────────────────────────────────────────────────────
const createSchema = z.object({
  subject:       z.string().min(2, 'Subject required').max(200),
  bodyHtml:      z.string().min(10, 'Email body required'),
  previewText:   z.string().max(200).optional(),
  internalNotes: z.string().max(1000).optional(),
  tags:          z.array(z.string().max(50)).max(10).optional(),
  segment:       z.enum(SEGMENTS),
  scheduledAt:   z.string().datetime({ message: 'Must be ISO 8601 datetime' }).optional(),
});

const updateSchema = createSchema.partial();

const listQuery = z.object({
  page:    z.coerce.number().min(1).default(1),
  limit:   z.coerce.number().min(1).max(100).default(20),
  status:  z.enum(['draft','scheduled','sending','sent','cancelled','failed']).optional(),
  segment: z.enum(SEGMENTS).optional(),
});

const estimateQuery = z.object({
  segment: z.enum(SEGMENTS),
});

export async function adminBroadcastRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticateAdmin);

  // ══ Stats ══════════════════════════════════════════════════════

  fastify.get('/stats', {
    schema: {
      tags: [TAG],
      summary: 'Broadcast stats — totals, recent campaigns, emails sent',
      security: AUTH,
    },
  }, async (_req, reply) => {
    sendSuccess(reply, await svc.getStats());
  });

  // ══ Estimate recipients ════════════════════════════════════════

  fastify.get('/estimate', {
    schema: {
      tags: [TAG],
      summary: 'Estimate how many users will receive a broadcast for a given segment',
      description: 'Call this before creating/sending to show the admin how large their audience is.',
      security: AUTH,
      querystring: {
        type: 'object', required: ['segment'],
        properties: {
          segment: { type: 'string', enum: SEGMENTS, description: 'User segment to target' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { segment } = estimateQuery.parse(req.query);
    sendSuccess(reply, await svc.estimateRecipients(segment));
  });

  // ══ List broadcasts ════════════════════════════════════════════

  fastify.get('/', {
    schema: {
      tags: [TAG],
      summary: 'List all broadcast campaigns with stats',
      security: AUTH,
      querystring: {
        type: 'object',
        properties: {
          page:    { type: 'integer', default: 1 },
          limit:   { type: 'integer', default: 20 },
          status:  { type: 'string', enum: ['draft','scheduled','sending','sent','cancelled','failed'] },
          segment: { type: 'string', enum: SEGMENTS },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const q = listQuery.parse(req.query);
    const { data, total } = await svc.list(q);
    sendSuccess(reply, data, undefined, 200, paginateMeta(total, q.page, q.limit));
  });

  // ══ Create broadcast ═══════════════════════════════════════════

  fastify.post('/', {
    schema: {
      tags: [TAG],
      summary: 'Create a broadcast campaign (starts as draft)',
      description: `
Create an email broadcast to send to a user segment. Starts as a **draft** — no emails sent yet.

**Segments:**
- \`all\` — every verified active user
- \`free_trial\` — users in their 90-day trial
- \`free\` — trial-expired free users (great for upgrade campaigns)
- \`premium\` — paying subscribers (product updates, feature launches)
- \`waitlist_members\` — users who joined from the waitlist
- \`inactive\` — users who haven't streamed in 14 days (re-engagement)

**scheduledAt** — optional ISO datetime. If provided, broadcast is scheduled and sent automatically at that time. Omit to send manually via POST /send.

**bodyHtml** — full HTML email body. Use the OmliveStream email style (dark purple theme). The system auto-generates a plain-text fallback.
      `.trim(),
      security: AUTH,
      body: {
        type: 'object',
        required: ['subject', 'bodyHtml', 'segment'],
        properties: {
          subject:       { type: 'string', minLength: 2, maxLength: 200, example: '🚀 New feature: AI video editing is here!' },
          bodyHtml:      { type: 'string', description: 'Full HTML email body (dark theme recommended)' },
          previewText:   { type: 'string', maxLength: 200, description: 'Preview text shown in email client inbox below subject', example: 'Edit your stream recordings with a single text prompt.' },
          internalNotes: { type: 'string', description: 'Admin-only notes — not visible to users', example: 'Part of Q2 feature launch campaign' },
          tags:          { type: 'array', items: { type: 'string' }, description: 'Labels for filtering, e.g. ["feature-update","launch"]' },
          segment:       { type: 'string', enum: SEGMENTS, description: 'Which users to target' },
          scheduledAt:   { type: 'string', format: 'date-time', description: 'Optional: schedule for future delivery (ISO 8601)' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const admin   = getAdminUser(req);
    const payload = createSchema.parse(req.body);
    sendCreated(reply, await svc.create(admin.sub, payload), 'Broadcast created');
  });

  // ══ Get broadcast detail ═══════════════════════════════════════

  fastify.get('/:id', {
    schema: {
      tags: [TAG],
      summary: 'Get broadcast detail — content, stats, and last 100 delivery logs',
      security: AUTH,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    sendSuccess(reply, await svc.get(req.params.id));
  });

  // ══ Preview rendered HTML ══════════════════════════════════════

  fastify.get('/:id/preview', {
    schema: {
      tags: [TAG],
      summary: 'Preview broadcast — returns raw HTML for admin preview in browser',
      security: AUTH,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const data = await svc.preview(req.params.id);
    // Return raw HTML so admin can view it in an iframe
    reply.header('Content-Type', 'text/html').send(data.body_html);
  });

  // ══ Update broadcast (draft only) ═════════════════════════════

  fastify.patch('/:id', {
    schema: {
      tags: [TAG],
      summary: 'Edit a draft or scheduled broadcast',
      description: 'Only draft and scheduled broadcasts can be edited. Once sending or sent, updates are rejected.',
      security: AUTH,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
      body: {
        type: 'object',
        properties: {
          subject:       { type: 'string' },
          bodyHtml:      { type: 'string' },
          previewText:   { type: 'string' },
          internalNotes: { type: 'string' },
          tags:          { type: 'array', items: { type: 'string' } },
          segment:       { type: 'string', enum: SEGMENTS },
          scheduledAt:   { type: 'string', format: 'date-time', nullable: true },
        },
      },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const admin   = getAdminUser(req);
    const payload = updateSchema.parse(req.body);
    sendSuccess(reply, await svc.update(admin.sub, req.params.id, payload), 'Broadcast updated');
  });

  // ══ Send now ═══════════════════════════════════════════════════

  fastify.post('/:id/send', {
    schema: {
      tags: [TAG],
      summary: 'Send broadcast immediately — queues all emails to the selected segment',
      description: `
Triggers immediate send of the broadcast. The system:
1. Fetches all users matching the segment
2. Creates a delivery log row per recipient  
3. Queues a BullMQ batch job — emails sent in batches of 50, 200ms apart  
4. Updates \`sent_count\` and \`failed_count\` as emails deliver  
5. Marks broadcast \`sent\` when complete

Returns immediately with the number of recipients queued. Check stats via GET /broadcasts/:id for live progress.
      `.trim(),
      security: AUTH,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const admin  = getAdminUser(req);
    const result = await svc.send(admin.sub, req.params.id);
    sendSuccess(reply, result, `Broadcast queued — ${result.queued} recipients will receive this email`);
  });

  // ══ Cancel scheduled broadcast ═════════════════════════════════

  fastify.post('/:id/cancel', {
    schema: {
      tags: [TAG],
      summary: 'Cancel a scheduled or draft broadcast',
      description: 'Removes the scheduled job and marks the broadcast as cancelled. Cannot cancel already-sent broadcasts.',
      security: AUTH,
      params: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const admin = getAdminUser(req);
    await svc.cancel(admin.sub, req.params.id);
    sendSuccess(reply, null, 'Broadcast cancelled');
  });

  // ══ Delete draft ═══════════════════════════════════════════════

  fastify.delete<{ Params: { id: string } }>('/:id', {
    schema: {
      tags: [TAG],
      summary: 'Permanently delete a draft broadcast',
      description: 'Only draft broadcasts can be deleted. Use cancel for scheduled ones.',
      security: AUTH,
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
    },
    preHandler: [requireRole('super_admin', 'admin')],
  }, async (req, reply: FastifyReply) => {
    const admin = getAdminUser(req);
    await svc.delete(admin.sub, req.params.id);
    sendNoContent(reply);
  });
}