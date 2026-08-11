import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthService } from './auth.service';
import { sendSuccess, sendNoContent } from '../../utils/response';
import { getAuthUser } from '../../utils/jwt';
import {
  sendOtpSchema, verifyOtpSchema, socialOAuthSchema, socialExchangeSchema,
  emailClaimRequestSchema, emailClaimConfirmSchema,
  refreshSchema, logoutSchema,
} from './auth.schema';
import type { SocialProvider } from './social-providers';
import { urls } from '../../config/env';
import { AppError } from '../../utils/errors';

interface SocialCallbackQuery {
  code?:              string;
  state?:             string;
  error?:             string;
  error_description?: string;
}

const svc = new AuthService();

export const sendOtpHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { email } = sendOtpSchema.parse(req.body);
  sendSuccess(reply, await svc.sendOtp(email, req.ip));
};

export const verifyOtpHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { email, code } = verifyOtpSchema.parse(req.body);
  sendSuccess(reply, await svc.verifyOtp(email, code, req.ip, req.headers['user-agent'] ?? ''));
};

// ── Social OAuth ─────────────────────────────────────────────────

// Step 1 — hand the frontend a URL to send the browser to.
export const getSocialUrlHandler = (provider: SocialProvider) =>
  async (_req: FastifyRequest, reply: FastifyReply) => {
    const state   = await svc.issueOAuthState(provider);
    const authUrl = svc.getSocialOAuthUrl(provider, state);
    // `state` is returned so the frontend can double-check the value that
    // comes back, but the authoritative check is server-side in the callback.
    sendSuccess(reply, { authUrl, state, provider });
  };

// Step 2 — the provider redirects the browser here. This is a browser
// navigation, not an API call, so it answers with a redirect rather than
// JSON, and every failure path lands the user back on a page that explains
// itself instead of on a bare JSON error.
export const socialCallbackHandler = (provider: SocialProvider) =>
  async (req: FastifyRequest<{ Querystring: SocialCallbackQuery }>, reply: FastifyReply) => {
    const { code, state, error, error_description: errorDescription } = req.query;
    const signIn = `${urls.site.replace(/\/$/, '')}/auth/callback`;

    // The user pressed "Cancel" on the consent screen, or the provider
    // refused. Neither is an exception — it is a normal outcome.
    if (error) {
      req.log.info({ provider, error, errorDescription }, 'social oauth declined');
      return reply.redirect(`${signIn}?status=declined&provider=${provider}`);
    }

    try {
      if (!code || !state) throw new AppError('Missing code or state', 400);

      const { provider: stateProvider } = await svc.consumeOAuthState(state);
      // A code issued for one provider must not be redeemable against
      // another, whose token endpoint would be called with the wrong secret.
      if (stateProvider && stateProvider !== provider) {
        throw new AppError('Provider mismatch on OAuth callback', 400);
      }

      const result = await svc.handleSocialOAuth(provider, code, req.ip, req.headers['user-agent'] ?? '');
      const ticket = await svc.parkSocialResult(result);

      return reply.redirect(`${signIn}?ticket=${encodeURIComponent(ticket)}&provider=${provider}`);
    } catch (err) {
      req.log.warn({ err, provider }, 'social oauth callback failed');
      return reply.redirect(`${signIn}?status=failed&provider=${provider}`);
    }
  };

// Step 3 — the frontend trades the ticket for the token pair, over a normal
// CORS request it can read, and stores the tokens itself.
export const socialExchangeHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { ticket } = socialExchangeSchema.parse(req.body);
  sendSuccess(reply, await svc.redeemSocialTicket(ticket));
};

// Legacy — the frontend used to POST the raw code here. Kept so a cached
// bundle mid-deploy still works; the callback route above is the live path.
export const socialOAuthHandler = (provider: SocialProvider) =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    const { code } = socialOAuthSchema.parse(req.body);
    const result   = await svc.handleSocialOAuth(provider, code, req.ip, req.headers['user-agent'] ?? '');
    sendSuccess(reply, { ...result, provider });
  };

// ── Email claim (social accounts with no provider-supplied address) ──
export const requestEmailClaimHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { email } = emailClaimRequestSchema.parse(req.body);
  sendSuccess(reply, await svc.requestEmailClaim(getAuthUser(req).id, email));
};

export const confirmEmailClaimHandler = async (req: FastifyRequest, reply: FastifyReply) => {
  const { code } = emailClaimConfirmSchema.parse(req.body);
  sendSuccess(reply, await svc.confirmEmailClaim(getAuthUser(req).id, code));
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
