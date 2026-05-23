import { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'crypto';
import { env } from '../config/env';
import { sendError } from '../utils/response';
import { getAuthUser } from '../utils/jwt';

export async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    sendError(reply, 'UNAUTHORIZED', 'Invalid or expired access token', 401);
  }
}

export async function requirePremium(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = getAuthUser(request);
  if (user.plan !== 'premium') {
    sendError(reply, 'PREMIUM_REQUIRED', 'This feature requires a Premium subscription', 403);
  }
}

export async function validatePaystackWebhook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const signature = request.headers['x-paystack-signature'] as string;
  if (!signature) { sendError(reply, 'INVALID_SIGNATURE', 'Missing webhook signature', 401); return; }

  const hash = crypto
    .createHmac('sha512', env.PAYSTACK_WEBHOOK_SECRET)
    .update(JSON.stringify(request.body))
    .digest('hex');

  if (hash !== signature) {
    sendError(reply, 'INVALID_SIGNATURE', 'Webhook signature mismatch', 401);
  }
}
