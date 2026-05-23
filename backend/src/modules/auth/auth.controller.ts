import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { sendSuccess, sendNoContent } from '../../utils/response';
import { getAuthUser } from '../../utils/jwt';
import {
  sendOtpSchema, verifyOtpSchema, socialOAuthSchema, refreshSchema, logoutSchema,
} from './auth.schema';

const svc = new AuthService();

export const sendOtpHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { email } = sendOtpSchema.parse(req.body);
  sendSuccess(reply, await svc.sendOtp(email, req.ip));
};

export const verifyOtpHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { email, code } = verifyOtpSchema.parse(req.body);
  sendSuccess(reply, await svc.verifyOtp(email, code, req.ip, req.headers['user-agent'] ?? ''));
};

// Social OAuth — get redirect URL
export const getSocialUrlHandler = (provider: 'google' | 'facebook' | 'instagram' | 'tiktok' | 'twitch') =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const { redis } = await import('../../config/redis');
    const { generateToken } = await import('../../utils/crypto');
    const { REDIS_KEYS } = await import('../../config/redis');
    const state   = generateToken(16);
    await redis.set(`oauth:auth:state:${state}`, '1', { ex: 300 });
    const authUrl = svc.getSocialOAuthUrl(provider, state);
    sendSuccess(reply, { authUrl, state, provider });
  };

// Social OAuth — exchange code for tokens
export const socialOAuthHandler = (provider: 'google' | 'facebook' | 'instagram' | 'tiktok' | 'twitch') =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = socialOAuthSchema.parse(req.body);
    const result   = await svc.handleSocialOAuth(provider, code, req.ip, req.headers['user-agent'] ?? '');
    sendSuccess(reply, { ...result, provider });
  };

export const refreshHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { refreshToken } = refreshSchema.parse(req.body);
  sendSuccess(reply, await svc.refreshAccessToken(refreshToken));
};

export const logoutHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { refreshToken } = logoutSchema.parse(req.body);
  await svc.logout(getAuthUser(req).id, refreshToken);
  sendNoContent(reply);
};
