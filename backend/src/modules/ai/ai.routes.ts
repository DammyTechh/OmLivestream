import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
// Type-only: the client lives in ai.client, and this file never constructs one.
import type OpenAI from 'openai';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../config/logger';
import { AppError } from '../../utils/errors';
import { complete, completeJson } from './ai.client';
import type { Platform } from '../../types/database';

const SYSTEM_PROMPT = `You are the OmliveStream AI Assistant — a helpful, knowledgeable guide embedded inside OmliveStream, a multi-platform live streaming SaaS.

OmliveStream lets creators go live on YouTube, TikTok, Instagram, Facebook, Twitch, Twitter, LinkedIn, and Kick simultaneously from a single dashboard.

Your role:
- Help users understand platform settings and features
- Troubleshoot stream quality issues (bitrate, resolution, network)
- Guide users through connecting platforms
- Suggest stream titles, descriptions, and best times to go live
- Explain how to use recordings, AI editing, and analytics
- Keep answers concise, friendly, and actionable

You do NOT have access to the user's recordings, private data, or account credentials.
Always stay on-topic about streaming and content creation.`;

/**
 * How many prior turns are replayed to the model.
 *
 * Every turn is re-sent on every request, so this is a direct multiplier on
 * cost. Ten keeps a coherent thread through a troubleshooting exchange
 * without paying to resend an hour-old conversation.
 */
const HISTORY_TURNS = 10;

/**
 * Daily AI calls for a non-Premium account.
 *
 * Each one costs us real money and the free plan is a trial, not an
 * allowance. Premium is uncapped, consistent with how maxStreamsPerDay
 * treats it in plans.service.
 */
const FREE_DAILY_AI_CALLS = 20;

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  /**
   * Accepted for backwards compatibility and ignored.
   *
   * History is now read from the server's own record of the conversation.
   * Trusting the client's copy meant a caller could rewrite what "the
   * assistant previously said" and steer the next reply with it.
   */
  history: z.array(z.object({
    role:    z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(50).optional(),
});

/**
 * Platforms the title generator knows how to write for.
 *
 * Pinned to the canonical `Platform` union rather than being a free-standing
 * list. The frontend's picker sends these ids verbatim, so a rename here that
 * drifted from the rest of the codebase — 'twitter' quietly becoming 'x', say
 * — would surface as a 422 on a request that looks entirely correct. The
 * annotation makes that a compile error instead.
 */
const TITLE_PLATFORMS: readonly [Platform, ...Platform[]] =
  ['youtube', 'tiktok', 'instagram', 'facebook', 'twitch', 'twitter', 'linkedin', 'kick'] as const;

const generateTitleSchema = z.object({
  topic: z.string().min(2).max(200),
  /**
   * Optional, defaulting to the four platforms the tone rules below cover
   * well. The dashboard's title generator sends a topic alone, and requiring
   * this made every one of those calls fail validation before it reached the
   * model.
   */
  platforms: z.array(z.enum(TITLE_PLATFORMS)).min(1).max(8).default(['youtube', 'tiktok', 'instagram', 'twitch']),
  tone: z.enum(['energetic', 'professional', 'casual', 'educational']).default('energetic'),
});

/** What the model must return for a title request. */
const titleResultSchema = z.object({
  titles: z.record(
    z.string(),
    z.object({
      title:       z.string().min(1).max(300),
      description: z.string().max(2000).default(''),
    }),
  ),
});

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /**
   * Refuse the call if this account has spent its day's allowance.
   *
   * Counted from ai_usage, which only records completions that actually
   * reached the model — a run of 503s does not consume the cap.
   */
  async function assertWithinDailyCap(userId: string, plan: string): Promise<void> {
    if (plan === 'premium') return;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count, error } = await supabaseAdmin
      .from('ai_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', startOfDay.toISOString());

    // A failed count must not lock a paying user out of a working feature.
    if (error) {
      logger.warn({ err: error, userId }, 'AI daily cap check failed — allowing the call');
      return;
    }

    if ((count ?? 0) >= FREE_DAILY_AI_CALLS) {
      throw new AppError(
        `You have used your ${FREE_DAILY_AI_CALLS} AI requests for today. Upgrade to Premium for unlimited AI.`,
        403,
        'AI_DAILY_LIMIT',
      );
    }
  }

  /**
   * POST /ai/chat
   *
   * Conversation history is stored server-side, so a reply follows from what
   * was actually said rather than from whatever the client chose to send back.
   */
  fastify.post('/chat', {
    schema: {
      tags: ['AI'],
      summary: 'Chat with the OmliveStream AI Assistant',
      description: 'GPT-4o-mini assistant for streaming tips, feature help and troubleshooting. Conversation history is kept server-side; the last 10 turns are replayed to the model.',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', maxLength: 2000 },
          history: {
            type: 'array',
            description: 'Deprecated and ignored — history is stored server-side.',
            items: {
              type: 'object',
              properties: {
                role:    { type: 'string', enum: ['user', 'assistant'] },
                content: { type: 'string' },
              },
            },
          },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const { message } = chatSchema.parse(req.body);

    const { data: profile } = await supabaseAdmin
      .from('users').select('plan,full_name').eq('id', u.id).single();
    const plan = profile?.plan ?? 'free';

    await assertWithinDailyCap(u.id, plan);

    // Oldest-first after the reverse, which is the order the model needs.
    const { data: priorRows } = await supabaseAdmin
      .from('ai_messages')
      .select('role,content')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS);
    const prior = (priorRows ?? []).slice().reverse();

    const userContext = `\nUser context: plan=${plan}, name=${profile?.full_name ?? 'Creator'}`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT + userContext },
      ...prior.map((h) => ({ role: h.role, content: h.content }) as OpenAI.ChatCompletionMessageParam),
      { role: 'user', content: message },
    ];

    const replyText = await complete({
      userId: u.id, feature: 'chat', model: 'gpt-4o-mini',
      messages, maxTokens: 800, temperature: 0.7,
    });

    // Both turns in one insert, after the call succeeded: recording the
    // question before the answer arrives leaves a dangling user turn in the
    // history that the next request would replay as unanswered.
    const { error: histErr } = await supabaseAdmin.from('ai_messages').insert([
      { user_id: u.id, role: 'user',      content: message },
      { user_id: u.id, role: 'assistant', content: replyText },
    ]);
    if (histErr) logger.warn({ err: histErr, userId: u.id }, 'AI history not saved');

    sendSuccess(reply, { reply: replyText });
  });

  /**
   * GET /ai/chat/history
   * Lets the dashboard reopen a conversation instead of restarting it.
   */
  fastify.get('/chat/history', {
    schema: {
      tags: ['AI'],
      summary: 'Recent AI conversation history',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const { data } = await supabaseAdmin
      .from('ai_messages')
      .select('role,content,created_at')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_TURNS * 2);

    sendSuccess(reply, { messages: (data ?? []).slice().reverse() });
  });

  /**
   * DELETE /ai/chat/history
   */
  fastify.delete('/chat/history', {
    schema: {
      tags: ['AI'],
      summary: 'Clear AI conversation history',
      security: [{ bearerAuth: [] }],
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    await supabaseAdmin.from('ai_messages').delete().eq('user_id', u.id);
    sendSuccess(reply, { cleared: true });
  });

  /**
   * POST /ai/generate-title
   *
   * Returns both `titles` (a flat list, which is what the dashboard renders)
   * and `byPlatform` (the per-platform title + description). The flat list is
   * not a convenience: the frontend has always read `titles: string[]` from
   * this endpoint, and the endpoint has always returned a nested object.
   */
  fastify.post('/generate-title', {
    schema: {
      tags: ['AI'],
      summary: 'Generate optimised stream titles and descriptions per platform',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['topic'],
        properties: {
          topic:     { type: 'string', description: 'What your stream is about' },
          platforms: { type: 'array', items: { type: 'string', enum: [...TITLE_PLATFORMS] } },
          tone:      { type: 'string', enum: ['energetic', 'professional', 'casual', 'educational'] },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const body = generateTitleSchema.parse(req.body);

    const { data: profile } = await supabaseAdmin
      .from('users').select('plan').eq('id', u.id).single();
    await assertWithinDailyCap(u.id, profile?.plan ?? 'free');

    const prompt = `Generate stream titles and descriptions optimised for each platform.
Topic: "${body.topic}"
Tone: ${body.tone}
Platforms: ${body.platforms.join(', ')}

Return ONLY valid JSON with this structure:
{"titles":{"youtube":{"title":"...","description":"..."}}}

Rules:
- YouTube: up to 100 chars, keyword-rich for SEO
- TikTok: punchy, max 60 chars
- Instagram/Facebook: casual, conversational
- Twitch: gaming/hype-friendly if applicable
- LinkedIn: professional, industry-focused
- Do not use emojis
- Include exactly these platforms and no others: ${body.platforms.join(', ')}`;

    const result = await completeJson({
      userId: u.id, feature: 'title', model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 600, temperature: 0.8,
    }, titleResultSchema);

    // Keep only what was asked for: the model occasionally adds a platform
    // that was not requested, and the dashboard would render it as a
    // suggestion the user cannot use.
    const byPlatform = Object.fromEntries(
      Object.entries(result.titles).filter(([k]) => (body.platforms as string[]).includes(k.toLowerCase())),
    );

    sendSuccess(reply, {
      titles: Object.values(byPlatform).map((t) => t.title),
      byPlatform,
    });
  });
}
