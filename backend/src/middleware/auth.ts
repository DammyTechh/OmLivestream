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

/**
 * Gate a route on a live Premium subscription.
 *
 * Resolved from the database, not from the token's `plan` claim. An access
 * token is a snapshot: one minted before an upgrade still says 'free', and —
 * the part that matters — one minted before a downgrade or a lapsed trial
 * still says 'premium' until it expires. Trusting the claim meant a cancelled
 * subscriber kept paid features for the life of their token.
 * getEffectivePlan also settles an expired trial as it reads, so it cannot be
 * outrun by holding on to an old token.
 */
export async function requirePremium(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = getAuthUser(request);
  try {
    const { PlansService } = await import('../modules/plans/plans.service');
    const { plan } = await new PlansService().getEffectivePlan(user.id);
    if (plan !== 'premium') {
      sendError(reply, 'PREMIUM_REQUIRED', 'This feature requires a Premium subscription', 403);
    }
  } catch {
    // Fail closed: if the plan cannot be established, do not hand out a paid
    // feature on the strength of an unverified claim.
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
