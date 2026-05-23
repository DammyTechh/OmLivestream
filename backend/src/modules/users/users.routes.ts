import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { UsersService } from './users.service';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess, sendNoContent } from '../../utils/response';
import { supabaseAdmin } from '../../config/supabase';
import { AuthService } from '../auth/auth.service';

const svc     = new UsersService();
const authSvc = new AuthService();

// ── Schemas ───────────────────────────────────────────────────────

const updateSchema = z.object({
  full_name:  z.string().min(2).max(100).optional(),
  dob:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format: YYYY-MM-DD').optional(),
  location:   z.string().max(100).optional(),
  avatar_url: z.string().url().optional(),
});

/**
 * Onboarding Step 1 — Personal info
 * Captured immediately after first sign-in (email OTP or social).
 */
const onboardingProfileSchema = z.object({
  full_name: z.string().min(2, 'Full name required').max(100),
  dob:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth required (format: YYYY-MM-DD)'),
  location:  z.string().min(2, 'Location required').max(100),
});

/**
 * Onboarding Step 2 — Survey
 * Understand the user — how they found us and what they plan to stream.
 */
const onboardingSurveySchema = z.object({
  heard_from: z.array(z.enum([
    'social_media', 'friend_referral', 'google_search', 'content_creator', 'youtube_ad', 'other',
  ])).min(1, 'Select at least one option'),
  use_case: z.array(z.enum([
    'entertainment',       // Gaming, vlogging, variety
    'gaming',              // Dedicated gaming streams
    'music_performance',   // Live music, concerts, DJ sets
    'education',           // Tutorials, courses, workshops
    'business_brand',      // Corporate events, product launches
    'fitness_wellness',    // Workout classes, yoga, coaching
    'events_concerts',     // Live events, conferences
    'news_commentary',     // News, politics, reactions
    'other',
  ])).min(1, 'Select at least one activity'),
});

const paginateQuery = z.object({
  page:  z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// ── Routes ────────────────────────────────────────────────────────

export async function usersRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  // ── Profile ──────────────────────────────────────────────────────
  fastify.get('/me', {
    schema: { tags: ['Users'], summary: 'Get current user profile', security: [{ bearerAuth: [] }] },
  }, async (req, reply) => {
    sendSuccess(reply, await svc.getProfile(getAuthUser(req).id));
  });

  fastify.get('/onboarding/status', {
    schema: { tags: ['Users'], summary: 'Check onboarding completion and fetch saved answers', security: [{ bearerAuth: [] }] },
  }, async (req, reply) => {
    sendSuccess(reply, await svc.getOnboardingStatus(getAuthUser(req).id));
  });

  fastify.patch('/me', {
    schema: {
      tags: ['Users'], summary: 'Update profile fields', security: [{ bearerAuth: [] }],
      body: { type: 'object', properties: {
        full_name:  { type: 'string', minLength: 2, maxLength: 100 },
        dob:        { type: 'string', description: 'YYYY-MM-DD' },
        location:   { type: 'string', maxLength: 100 },
        avatar_url: { type: 'string', format: 'uri' },
      }},
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    sendSuccess(reply, await svc.updateProfile(u.id, updateSchema.parse(req.body)), 'Profile updated');
  });

  fastify.delete('/me', {
    schema: {
      tags: ['Users'], summary: 'Delete own account permanently — irreversible',
      description: 'Cancels Paystack subscription, removes Storage files, cascades all DB records.',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    await svc.deleteAccount(getAuthUser(req).id);
    sendNoContent(reply);
  });

  // ══════════════════════════════════════════════════════════════
  //  ONBOARDING FLOW — 3 Steps after first sign-in
  // ══════════════════════════════════════════════════════════════

  /**
   * Step 1 — Personal details
   * POST /users/onboarding/profile
   *
   * Collects: full name, date of birth, location.
   * Must be called FIRST before Step 2.
   * After this, redirect to Step 2.
   */
  fastify.post('/onboarding/profile', {
    schema: {
      tags: ['Users'],
      summary: 'Onboarding Step 1 — Personal details (name, DOB, location)',
      description: `
**Call this immediately after first sign-in when \`isNewUser: true\`.**

Collects the user's full name, date of birth (for birthday emails and age verification — must be 13+), and location.

After saving, redirect to **Step 2: POST /users/onboarding/survey**
      `.trim(),
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['full_name', 'dob', 'location'],
        properties: {
          full_name: { type: 'string', minLength: 2, maxLength: 100, example: 'Adebayo Okafor', description: 'Creator full name' },
          dob:       { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', example: '1998-03-15', description: 'Date of birth — YYYY-MM-DD. Used for birthday emails. Must be 13+.' },
          location:  { type: 'string', maxLength: 100, example: 'Lagos, Nigeria', description: 'City, Country' },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u    = getAuthUser(req);
    const body = onboardingProfileSchema.parse(req.body);
    await svc.saveOnboardingProfile(u.id, body);
    sendSuccess(reply, { nextStep: 'POST /users/onboarding/survey' }, 'Profile saved — proceed to Step 2');
  });

  /**
   * Step 2 — Creator survey
   * POST /users/onboarding/survey
   *
   * Collects: how they heard about OmliveStream, what they plan to stream.
   * After this, redirect to Step 3 (connect first platform via /platforms/connect/oauth).
   */
  fastify.post('/onboarding/survey', {
    schema: {
      tags: ['Users'],
      summary: 'Onboarding Step 2 — Creator survey (discovery + stream activities)',
      description: `
**How did you hear about us? What will you stream?**

Multi-select answers for both questions. After saving, redirect to **Step 3: POST /platforms/connect/oauth** to connect the first streaming platform.
      `.trim(),
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['heard_from', 'use_case'],
        properties: {
          heard_from: {
            type: 'array',
            description: 'How did you discover OmliveStream? (multi-select)',
            items: { type: 'string', enum: ['social_media','friend_referral','google_search','content_creator','youtube_ad','other'] },
            minItems: 1,
            example: ['social_media', 'friend_referral'],
          },
          use_case: {
            type: 'array',
            description: 'What will you use OmliveStream for? (multi-select)',
            items: { type: 'string', enum: ['entertainment','gaming','music_performance','education','business_brand','fitness_wellness','events_concerts','news_commentary','other'] },
            minItems: 1,
            example: ['gaming', 'entertainment'],
          },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u    = getAuthUser(req);
    const body = onboardingSurveySchema.parse(req.body);
    await svc.saveOnboardingSurvey(u.id, body);
    sendSuccess(reply, { nextStep: 'POST /platforms/connect/oauth' }, 'Survey saved — connect your first platform');
  });

  /**
   * Step 3 — handled by POST /platforms/connect/oauth (separate module)
   * After connecting their first platform (or skipping), user lands on the dashboard.
   */

  // ── Subscription ─────────────────────────────────────────────────
  fastify.get('/me/subscription', {
    schema: {
      tags: ['Users'],
      summary: 'Current subscription — plan, status, days remaining, billing cycle',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    sendSuccess(reply, await svc.getSubscription(getAuthUser(req).id));
  });

  // ── Login history ────────────────────────────────────────────────
  fastify.get('/me/login-history', {
    schema: {
      tags: ['Users'],
      summary: 'Personal login history — device, IP, new-device flag, risk level',
      description: '`is_new_device: true` means a security alert email was sent. `risk_level: high` means admin has been notified.',
      security: [{ bearerAuth: [] }],
      querystring: { type: 'object', properties: { page: { type: 'integer', default: 1 }, limit: { type: 'integer', default: 20 } } },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const { page, limit } = paginateQuery.parse(req.query);
    const { data, count } = await supabaseAdmin
      .from('login_logs')
      .select('id,ip_address,user_agent,is_new_device,risk_level,created_at', { count: 'exact' })
      .eq('user_id', u.id).order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    sendSuccess(reply, data ?? [], undefined, 200, { page, limit, total: count ?? 0, hasMore: page * limit < (count ?? 0) });
  });

  // ── Active sessions ───────────────────────────────────────────────
  fastify.get('/me/sessions', {
    schema: {
      tags: ['Users'], summary: 'Active sessions — all logged-in devices', security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    sendSuccess(reply, await authSvc.listSessions(getAuthUser(req).id));
  });

  fastify.delete('/me/sessions/:sessionId', {
    schema: {
      tags: ['Users'], summary: 'Log out a specific device', security: [{ bearerAuth: [] }],
      params: { type: 'object', properties: { sessionId: { type: 'string', format: 'uuid' } } },
    },
  }, async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    const u = getAuthUser(req);
    await supabaseAdmin.from('sessions').delete().eq('id', req.params.sessionId).eq('user_id', u.id);
    sendNoContent(reply);
  });

  fastify.post('/me/sessions/revoke-all', {
    schema: {
      tags: ['Users'], summary: 'Emergency: sign out of all devices immediately',
      security: [{ bearerAuth: [] }],
    },
  }, async (req, reply) => {
    await authSvc.revokeAllSessions(getAuthUser(req).id);
    sendSuccess(reply, null, 'Signed out of all devices');
  });
}
