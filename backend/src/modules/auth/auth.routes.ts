import { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/auth';
import {
  sendOtpHandler, verifyOtpHandler, getSocialUrlHandler,
  socialCallbackHandler, socialExchangeHandler, socialOAuthHandler,
  requestEmailClaimHandler, confirmEmailClaimHandler,
  refreshHandler, logoutHandler,
} from './auth.controller';
import {
  sendOtpJsonSchema, verifyOtpJsonSchema, socialUrlJsonSchema,
  socialCallbackJsonSchema, socialExchangeJsonSchema,
  socialOAuthJsonSchema, emailClaimRequestJsonSchema, emailClaimConfirmJsonSchema,
  refreshJsonSchema, logoutJsonSchema,
} from './auth.schema';
import { SOCIAL_PROVIDERS, type SocialProvider } from './social-providers';
import { sendSuccess } from '../../utils/response';

/** Registered once per provider, from one list, so a provider cannot be
 *  half-wired — an authorize URL with no callback to receive the redirect is
 *  exactly the state this flow was in before. */
const PROVIDERS: { id: SocialProvider; label: string }[] = [
  { id: 'google',    label: 'Google'    },
  { id: 'facebook',  label: 'Facebook'  },
  // Instagram is deliberately absent from *sign-in*, for two separate reasons:
  //
  //  1. It cannot work. Sign-in used the Instagram Basic Display API, which
  //     Meta shut down on 4 December 2024 — its authorize endpoint now returns
  //     Instagram's "this page isn't available" 404, which is exactly what we
  //     were seeing.
  //
  //  2. It is not permitted. Meta's own policy states Basic Display "is not an
  //     authentication tool… if your app uses API data to authenticate users,
  //     it will be rejected during App Review," and directs apps to use
  //     Facebook Login instead. So migrating to the replacement API would not
  //     make an Instagram sign-in button approvable either.
  //
  // Facebook Login already covers these users. Instagram remains fully
  // available as a broadcast destination under Platforms, which uses the
  // Instagram Graph API and is unaffected by any of this.
  //
  // TikTok and Twitch are also absent from sign-in.
  //
  // Neither adds a way in that Google, Facebook or an email code does not
  // already cover, and both cost something to keep: TikTok's login product
  // needs its own review, and Twitch will not issue credentials until the
  // account clears 2FA. A button that opens a provider error page is worse
  // than no button.
  //
  // This is only about signing in. Both remain fully available as broadcast
  // destinations under Platforms, which is a different set of credentials
  // (TIKTOK_CLIENT_KEY / TWITCH_CLIENT_ID) and a different callback path.
];

export async function authRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Email OTP (passwordless) ──────────────────────────────────
  fastify.post('/send-otp',   { schema: sendOtpJsonSchema },   sendOtpHandler);
  fastify.post('/verify-otp', { schema: verifyOtpJsonSchema }, verifyOtpHandler);

  // ── Social OAuth ──────────────────────────────────────────────
  for (const { id, label } of PROVIDERS) {
    // 1. Frontend asks for the URL to send the browser to.
    fastify.get(`/social/${id}/url`, { schema: socialUrlJsonSchema(label) }, getSocialUrlHandler(id));

    // 2. The provider redirects the browser back here. This path must match
    //    the redirect URI registered in the provider's console exactly —
    //    see Docs/PLATFORM_API_SETUP.md.
    fastify.get(`/social/${id}/callback`, { schema: socialCallbackJsonSchema(label) }, socialCallbackHandler(id));

    // Legacy code-post path, retained for bundles cached mid-deploy.
    fastify.post(`/social/${id}`, { schema: socialOAuthJsonSchema(label) }, socialOAuthHandler(id));
  }

  // 3. Frontend trades its one-time ticket for the token pair.
  fastify.post('/social/exchange', { schema: socialExchangeJsonSchema }, socialExchangeHandler);

  /** Which buttons the sign-in page should render. A provider with no
   *  credentials configured returns a 503 from the URL route, so showing its
   *  button would be advertising a dead end. */
  fastify.get('/social/providers', {
    schema: {
      tags: ['Auth'],
      summary: 'Which social sign-in providers are configured and usable',
    },
  }, async (_req, reply) => {
    const available = PROVIDERS
      .filter(({ id }) => Boolean(SOCIAL_PROVIDERS[id].clientId && SOCIAL_PROVIDERS[id].clientSecret))
      .map(({ id, label }) => ({ id, label }));
    reply.header('Cache-Control', 'public, max-age=300');
    sendSuccess(reply, available);
  });

  // ── Email claim — authenticated, for social accounts with no address ──
  fastify.post('/email/claim', {
    schema: emailClaimRequestJsonSchema, preHandler: [authenticate],
  }, requestEmailClaimHandler);
  fastify.post('/email/claim/confirm', {
    schema: emailClaimConfirmJsonSchema, preHandler: [authenticate],
  }, confirmEmailClaimHandler);

  // ── Token management ─────────────────────────────────────────
  fastify.post('/refresh', { schema: refreshJsonSchema }, refreshHandler);
  fastify.post('/logout',  { schema: logoutJsonSchema, preHandler: [authenticate] }, logoutHandler);
}
