import { z } from 'zod';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PlatformsService } from './platforms.service';
import { authenticate } from '../../middleware/auth';
import { getAuthUser } from '../../utils/jwt';
import { sendSuccess, sendNoContent } from '../../utils/response';
import { generateToken } from '../../utils/crypto';
import { redis, REDIS_KEYS } from '../../config/redis';
import { env } from '../../config/env';
import type { Platform } from '../../types/database';

const svc = new PlatformsService();
const PLATFORMS = ['youtube','tiktok','instagram','facebook','twitch','twitter','linkedin','kick'] as const;

const oauthSchema = z.object({ platform: z.enum(['youtube','tiktok','instagram','facebook','twitch','twitter','linkedin']) });
const manualSchema = z.object({ platform: z.enum(PLATFORMS), rtmpUrl: z.string().url(), streamKey: z.string().min(1) });

export async function platformsRoutes(fastify: FastifyInstance): Promise<void> {
  // OAuth callback — CSRF-validated, no bearer needed
  fastify.get<{ Params: { platform: string }; Querystring: { code: string; state: string } }>('/oauth/callback/:platform', {
    schema: { tags: ['Platforms'], summary: 'OAuth callback (redirect from platform)',
      params: { type: 'object', properties: { platform: { type: 'string' } } },
      querystring: { type: 'object', required: ['code','state'], properties: { code: { type: 'string' }, state: { type: 'string' } } } },
  }, async (req, reply) => {
    const { platform } = req.params as { platform: string };
    const q = req.query as { code: string; state: string };
    const code  = q.code;
    const state = q.state;
    const userId = await redis.get(REDIS_KEYS.OAUTH_STATE(state));
    if (!userId) return reply.status(400).send({ success: false, error: { code: 'INVALID_STATE', message: 'OAuth state invalid or expired' } });
    await redis.del(REDIS_KEYS.OAUTH_STATE(state));
    await svc.handleOAuthCallback(platform as Platform, code, userId as string);
    reply.redirect(`${env.FRONTEND_URL}/settings/platforms?connected=${platform}`);
  });

  // All routes below require auth
  fastify.register(async (r) => {
    r.addHook('preHandler', authenticate);

    r.get('/', { schema: { tags: ['Platforms'], summary: 'List connected platforms', security: [{ bearerAuth: [] }] } },
      async (req, reply) => { const u = getAuthUser(req); sendSuccess(reply, await svc.listConnections(u.id)); });

    r.post('/connect/oauth', { schema: { tags: ['Platforms'], summary: 'Get OAuth URL for a platform', security: [{ bearerAuth: [] }],
      body: { type: 'object', required: ['platform'], properties: { platform: { type: 'string', enum: ['youtube','tiktok','instagram','facebook','twitch','twitter','linkedin'] } } } } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const u = getAuthUser(req); const { platform } = oauthSchema.parse(req.body);
        const state = generateToken(16);
        await redis.set(REDIS_KEYS.OAUTH_STATE(state), u.id, { ex: 300 });
        sendSuccess(reply, { authUrl: svc.getOAuthUrl(platform as Platform, state) });
      });

    r.post('/connect/manual', { schema: { tags: ['Platforms'], summary: 'Connect via manual RTMP stream key (Kick etc)', security: [{ bearerAuth: [] }],
      body: { type: 'object', required: ['platform','rtmpUrl','streamKey'], properties: { platform: { type: 'string' }, rtmpUrl: { type: 'string' }, streamKey: { type: 'string' } } } } },
      async (req: FastifyRequest, reply: FastifyReply) => {
        const u = getAuthUser(req); const b = manualSchema.parse(req.body);
        await svc.connectManual(u.id, b.platform, b.rtmpUrl, b.streamKey);
        sendSuccess(reply, null, `${b.platform} connected`);
      });

    r.delete('/:id', { schema: { tags: ['Platforms'], summary: 'Disconnect a platform', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        const u = getAuthUser(req); await svc.disconnect(u.id, req.params.id); sendNoContent(reply); });

    r.post('/:id/reconnect', { schema: { tags: ['Platforms'], summary: 'Refresh platform tokens', security: [{ bearerAuth: [] }] } },
      async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
        const u = getAuthUser(req); await svc.reconnect(u.id, req.params.id);
        sendSuccess(reply, null, 'Platform reconnected'); });
  });
}