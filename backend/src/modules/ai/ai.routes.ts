import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import OpenAI from 'openai';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess } from '../../utils/response';
import { supabaseAdmin } from '../../config/supabase';
import { env } from '../../config/env';

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });

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
Keep conversation history to the last 10 messages to stay focused.
Always stay on-topic about streaming and content creation.`;

const chatSchema = z.object({
  message: z.string().min(1).max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
  })).max(10).default([]),
});

const generateTitleSchema = z.object({
  topic: z.string().min(2).max(200),
  platforms: z.array(z.string()).min(1),
  tone: z.enum(['energetic', 'professional', 'casual', 'educational']).default('energetic'),
});

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /ai/chat
   * GPT-4o-mini powered assistant — answers questions about OmliveStream features,
   * streaming tips, and troubleshooting. Cost-efficient model for conversational use.
   */
  fastify.post('/chat', {
    schema: {
      tags: ['AI'],
      summary: 'Chat with the OmliveStream AI Assistant',
      description: 'GPT-4o-mini powered assistant for streaming tips, feature help, and troubleshooting. History is managed client-side (last 10 messages).',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['message'],
        properties: {
          message: { type: 'string', maxLength: 2000 },
          history: { type: 'array', items: { type: 'object', properties: { role: { type: 'string', enum: ['user', 'assistant'] }, content: { type: 'string' } } } },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const u = getAuthUser(req);
    const { message, history } = chatSchema.parse(req.body);

    // Attach user context to system prompt
    const { data: profile } = await supabaseAdmin.from('users').select('plan,full_name').eq('id', u.id).single();
    const userContext = `\nUser context: plan=${profile?.plan ?? 'free'}, name=${profile?.full_name ?? 'Creator'}`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT + userContext },
      ...history.map(h => ({ role: h.role, content: h.content } as OpenAI.ChatCompletionMessageParam)),
      { role: 'user', content: message },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
      max_tokens: 800,
      temperature: 0.7,
    });

    const reply_text = completion.choices[0]?.message?.content ?? 'Sorry, I could not generate a response. Please try again.';
    sendSuccess(reply, { reply: reply_text });
  });

  /**
   * POST /ai/generate-title
   * Generates optimised stream titles for each selected platform.
   * GPT-4o-mini — fast and cost-efficient for this use case.
   */
  fastify.post('/generate-title', {
    schema: {
      tags: ['AI'],
      summary: 'Generate optimised stream title and description for each platform',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object',
        required: ['topic', 'platforms'],
        properties: {
          topic: { type: 'string', description: 'What your stream is about' },
          platforms: { type: 'array', items: { type: 'string' } },
          tone: { type: 'string', enum: ['energetic', 'professional', 'casual', 'educational'] },
        },
      },
    },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const body = generateTitleSchema.parse(req.body);

    const prompt = `Generate stream titles and descriptions optimised for each platform.
Topic: "${body.topic}"
Tone: ${body.tone}
Platforms: ${body.platforms.join(', ')}

Return ONLY valid JSON with this structure (no markdown):
{
  "titles": {
    "youtube": { "title": "...", "description": "..." },
    "tiktok": { "title": "...", "description": "..." }
  }
}

Rules:
- YouTube: up to 100 chars, keyword-rich for SEO
- TikTok: punchy, emoji-friendly, max 60 chars
- Instagram/Facebook: casual, conversational
- Twitch: gaming/hype-friendly if applicable
- LinkedIn: professional, industry-focused
Only include platforms requested.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { parsed = {}; }

    sendSuccess(reply, parsed);
  });
}
