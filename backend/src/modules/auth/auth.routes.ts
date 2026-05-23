import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth';
import {
  sendOtpHandler, verifyOtpHandler, getSocialUrlHandler,
  socialOAuthHandler, refreshHandler, logoutHandler,
} from './auth.controller';
import {
  sendOtpJsonSchema, verifyOtpJsonSchema, socialUrlJsonSchema,
  socialOAuthJsonSchema, refreshJsonSchema, logoutJsonSchema,
} from './auth.schema';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Email OTP (passwordless) ──────────────────────────────────
  fastify.post('/send-otp',   { schema: sendOtpJsonSchema },   sendOtpHandler);
  fastify.post('/verify-otp', { schema: verifyOtpJsonSchema }, verifyOtpHandler);

  // ── Social OAuth — get redirect URL ──────────────────────────
  // Frontend calls these to get the URL, then redirects user to it
  fastify.get('/social/google/url',    { schema: socialUrlJsonSchema('Google') },    getSocialUrlHandler('google'));
  fastify.get('/social/facebook/url',  { schema: socialUrlJsonSchema('Facebook') },  getSocialUrlHandler('facebook'));
  fastify.get('/social/instagram/url', { schema: socialUrlJsonSchema('Instagram') }, getSocialUrlHandler('instagram'));
  fastify.get('/social/tiktok/url',    { schema: socialUrlJsonSchema('TikTok') },    getSocialUrlHandler('tiktok'));
  fastify.get('/social/twitch/url',    { schema: socialUrlJsonSchema('Twitch') },    getSocialUrlHandler('twitch'));

  // ── Social OAuth — exchange code for tokens ───────────────────
  // Frontend calls these after provider redirects back with ?code=...
  fastify.post('/social/google',    { schema: socialOAuthJsonSchema('Google') },    socialOAuthHandler('google'));
  fastify.post('/social/facebook',  { schema: socialOAuthJsonSchema('Facebook') },  socialOAuthHandler('facebook'));
  fastify.post('/social/instagram', { schema: socialOAuthJsonSchema('Instagram') }, socialOAuthHandler('instagram'));
  fastify.post('/social/tiktok',    { schema: socialOAuthJsonSchema('TikTok') },    socialOAuthHandler('tiktok'));
  fastify.post('/social/twitch',    { schema: socialOAuthJsonSchema('Twitch') },    socialOAuthHandler('twitch'));

  // ── Token management ─────────────────────────────────────────
  fastify.post('/refresh', { schema: refreshJsonSchema }, refreshHandler);
  fastify.post('/logout',  { schema: logoutJsonSchema, preHandler: [authenticate] }, logoutHandler);
}
