/**
 * OmliveStream Auth Service
 * ─────────────────────────────────────────────────────────────────
 * 100% passwordless. Two paths:
 *
 *  Path A — Email OTP
 *    1. POST /auth/send-otp    { email }
 *    2. POST /auth/verify-otp  { email, code }
 *    → { accessToken, refreshToken, isNewUser }
 *
 *  Path B — Social OAuth (Google, Facebook, Instagram, TikTok, Twitch)
 *    1. GET /auth/social/:provider/url       → { authUrl, state }
 *    2. Provider redirects the browser to
 *       GET /auth/social/:provider/callback  ?code&state
 *    3. That handler redirects to the frontend with a one-time ticket, which
 *       the frontend trades at POST /auth/social/exchange for the token pair.
 *    → { accessToken, refreshToken, isNewUser, needsEmail }
 *
 *    Tokens travel via a ticket rather than in the redirect URL itself: a URL
 *    carrying a JWT lands in browser history, the Referer header and any
 *    proxy log between here and the user.
 *
 *  After either path, isNewUser === true triggers the 3-step onboarding flow:
 *    Step 1: POST /users/onboarding/profile   { full_name, dob, location }
 *    Step 2: POST /users/onboarding/survey    { heard_from[], use_case[] }
 *    Step 3: POST /platforms/connect/oauth    { platform }  (connect first platform)
 */

import jwt from 'jsonwebtoken';
import { logger } from '../../config/logger';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { supabaseAdmin } from '../../config/supabase';
import { redis, REDIS_KEYS } from '../../config/redis';
import { env } from '../../config/env';
import { generateOtp, generateToken, hashOtp, safeCompare, sha256 } from '../../utils/crypto';
import { SOCIAL_PROVIDERS, isProviderConfigured, type SocialProvider, type SocialProfile } from './social-providers';
import { UnauthorizedError, TooManyRequestsError, AppError } from '../../utils/errors';
import type { TokenPair, Plan } from '../../types/database';
import { EmailService } from '../email/email.service';

const emailSvc = new EmailService();

/** How long a user has to complete the provider's consent screen. */
const OAUTH_STATE_TTL_SECONDS = 600;

/** Long enough for one redirect hop, short enough that a leaked ticket is worthless. */
const OAUTH_TICKET_TTL_SECONDS = 120;

export interface SocialSignInResult extends TokenPair {
  isNewUser:  boolean;
  /** Provider disclosed no email — onboarding must collect one. */
  needsEmail: boolean;
}

// ── Device fingerprint from request metadata ──────────────────────
function deviceFingerprint(userAgent: string, ip: string): string {
  return crypto.createHash('sha256').update(`${userAgent}||${ip}`).digest('hex').slice(0, 32);
}

export class AuthService {

  // ══════════════════════════════════════════════════════════════
  //  PATH A — PASSWORDLESS EMAIL OTP
  // ══════════════════════════════════════════════════════════════

  /**
   * Step 1: Send 6-digit OTP to email.
   * Creates an unverified account if the email is new.
   */
  async sendOtp(email: string, ip: string): Promise<{ isNewUser: boolean; message: string }> {
    // Rate-limit: 5 OTP requests per email per hour
    const rateKey = REDIS_KEYS.OTP_RATE(email);
    const count   = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, 3600);
    if (count > env.RATE_LIMIT_AUTH_MAX) {
      throw new TooManyRequestsError(
        `Too many OTP requests — wait 1 hour. (${count - 1}/${env.RATE_LIMIT_AUTH_MAX} used)`
      );
    }

    // Find or create user (no password ever)
    let { data: user } = await supabaseAdmin
      .from('users').select('id,email,is_verified,status').eq('email', email).maybeSingle();

    if (user?.status === 'banned')    throw new UnauthorizedError('Account banned. Contact support@omlivestream.com');
    if (user?.status === 'suspended') throw new UnauthorizedError('Account suspended. Contact support@omlivestream.com');

    let isNewUser = false;
    if (!user) {
      const { data: created, error } = await supabaseAdmin
        .from('users')
        .insert({
          id: uuidv4(), email,
          plan:             'free_trial',
          is_verified:      false,
          status:           'active',
          trial_started_at: new Date().toISOString(),
          trial_expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        })
        .select('id,email,is_verified,status').single();
      if (error || !created) {
        // Log the actual Supabase error so it shows in backend logs
        logger.error({ supabaseError: error, email }, 'User insert failed');
        throw new AppError(
          `Failed to create account: ${error?.message || 'Unknown database error'}`,
          500
        );
      }
      user = created;
      isNewUser = true;
    }

    // Invalidate any previous unused OTPs
    const u = user!;
    await supabaseAdmin.from('otp_codes').delete().eq('user_id', u.id).is('used_at', null);

    // Generate cryptographically random 6-digit OTP
    const otp       = generateOtp(6);
    const codeHash  = hashOtp(otp);
    const expiresAt = new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60_000).toISOString();

    const { error: otpInsertError } = await supabaseAdmin.from('otp_codes').insert({
      id: uuidv4(), user_id: u.id, code_hash: codeHash,
      type: isNewUser ? 'register' : 'login',
      attempts: 0, expires_at: expiresAt, used_at: null,
    });

    if (otpInsertError) {
      // Most common cause: old CHECK constraint blocks 'login' type.
      // Run migrate_v6_otp_fix.sql on your Supabase DB to fix permanently.
      throw new AppError(`Could not store OTP: ${otpInsertError.message}`, 500);
    }

    // Send via Resend (never logs or returns the raw OTP)
    await emailSvc.sendOtpEmail(email, otp, isNewUser);

    return {
      isNewUser,
      message: `A ${env.OTP_EXPIRY_MINUTES}-minute verification code has been sent to ${email}`,
    }; // u is defined above
  }

  /**
   * Step 2: Verify OTP and issue JWT token pair.
   * On success, fires device tracking + login email alert if new device.
   */
  async verifyOtp(
    email: string, code: string, ip: string, userAgent: string
  ): Promise<TokenPair & { isNewUser: boolean }> {
    const { data: user } = await supabaseAdmin
      .from('users').select('id,email,plan,is_verified,status').eq('email', email).maybeSingle();

    if (!user) throw new UnauthorizedError('No account found for that email — send a new code');
    if (user.status === 'banned')    throw new UnauthorizedError('Account banned. Contact support@omlivestream.com');
    if (user.status === 'suspended') throw new UnauthorizedError('Account suspended. Contact support@omlivestream.com');

    // Get latest unused OTP
    const { data: otp } = await supabaseAdmin
      .from('otp_codes').select('*').eq('user_id', user.id).is('used_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!otp)                             throw new UnauthorizedError('No active code — request a new one');
    if (new Date(otp.expires_at) < new Date()) throw new UnauthorizedError('Code expired — request a new one');
    if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
      await supabaseAdmin.from('otp_codes').delete().eq('id', otp.id);
      throw new TooManyRequestsError(`Too many wrong attempts — request a new code`);
    }

    // Constant-time comparison — prevents timing attacks
    if (!safeCompare(hashOtp(code), otp.code_hash)) {
      await supabaseAdmin.from('otp_codes')
        .update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
      const remaining = env.OTP_MAX_ATTEMPTS - (otp.attempts + 1);
      throw new UnauthorizedError(`Incorrect code — ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining`);
    }

    // Mark OTP used
    await supabaseAdmin.from('otp_codes').update({ used_at: new Date().toISOString() }).eq('id', otp.id);

    const isNewUser = !user.is_verified;
    if (isNewUser) {
      await supabaseAdmin.from('users').update({ is_verified: true }).eq('id', user.id);
      await emailSvc.sendWelcomeEmail(email);
      // Grant waitlist reward if this email was on the waitlist
      try {
        const { WaitlistService } = await import('../waitlist/waitlist.service');
        await new WaitlistService().grantWaitlistReward(email, user!.id);
      } catch { /* non-fatal */ }
    }

    const tokens = await this.issueTokens(user.id, user.email, user.plan as Plan, ip, userAgent);
    await this.trackLogin(user.id, user.email, ip, userAgent, isNewUser);

    return { ...tokens, isNewUser };
  }

  // ══════════════════════════════════════════════════════════════
  //  PATH B — SOCIAL OAUTH (Google, Facebook, Instagram, TikTok, Twitch)
  // ══════════════════════════════════════════════════════════════

  /**
   * Builds the provider's authorize URL. The frontend sends the browser here;
   * the provider redirects back to our own callback with ?code & ?state.
   */
  getSocialOAuthUrl(provider: SocialProvider, state: string): string {
    const cfg = SOCIAL_PROVIDERS[provider];
    if (!cfg) throw new AppError(`Unsupported provider: ${provider}`, 400);
    if (!isProviderConfigured(provider)) {
      throw new AppError(`${provider} sign-in is not available right now.`, 503, 'PROVIDER_UNCONFIGURED');
    }

    const params = new URLSearchParams({
      // TikTok names this parameter `client_key`; everyone else `client_id`.
      [cfg.clientIdParam ?? 'client_id']: cfg.clientId,
      redirect_uri:  cfg.redirectUri,
      response_type: 'code',
      scope:         cfg.scopes.join(' '),
      state,
      ...(cfg.extra ?? {}),
    });

    return `${cfg.authUrl}?${params.toString()}`;
  }

  /**
   * Verifies the state parameter and consumes it.
   *
   * State is single-use: a replayed callback must not mint a second session,
   * and the delete is what makes the code exchange below un-replayable too.
   * Returns the provider the flow was started for, so a code obtained under
   * one provider cannot be redeemed against another.
   */
  async consumeOAuthState(state: string): Promise<{ provider: SocialProvider | null; returnTo?: string }> {
    const key = REDIS_KEYS.OAUTH_STATE_V2(state);
    const raw = await redis.get<unknown>(key);
    if (!raw) throw new UnauthorizedError('This sign-in link has expired. Please try again.');
    await redis.del(key);

    // Older states were stored as the bare string "1" with no provider. Treat
    // those as valid-but-unattributed rather than rejecting mid-deploy.
    //
    // The shape also depends on the Redis transport: Upstash's REST client
    // parses JSON on read, a TCP client returns the raw string. Handling both
    // matters here even though the catch below hides a failure — silently
    // returning provider:null loses `returnTo`, which is what sends the mobile
    // app back to itself after sign-in.
    try {
      const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as
        { provider?: SocialProvider; returnTo?: string };
      // Re-checked on the way out as well as in: a value that somehow reached
      // Redis without passing the allowlist still must not be redirected to.
      const returnTo = AuthService.isAllowedNativeReturn(parsed.returnTo)
        ? parsed.returnTo : undefined;
      return { provider: parsed.provider ?? null, returnTo };
    } catch {
      return { provider: null };
    }
  }

  /** Records a freshly-minted state so the callback can verify it. */
  /**
   * Only the mobile app's own scheme may be returned to.
   *
   * The callback redirects the browser wherever this says, so accepting an
   * arbitrary value would turn sign-in into an open redirect — an attacker
   * could send someone through a legitimate Google consent screen and have the
   * resulting ticket delivered to a host they control. An allowlist of exact
   * prefixes is the only safe form of this feature.
   */
  private static readonly NATIVE_RETURN_PREFIXES = ['omlivestream://'];

  /**
   * Expo Go hands back a different scheme.
   *
   * A standalone build redirects to `omlivestream://…`, but inside Expo Go the
   * app has no scheme of its own — `Linking.createURL()` produces
   * `exp://192.168.x.x:8081/--/auth/callback`, pointing at the developer's
   * Metro server. Rejecting that means social sign-in can never be tested on a
   * real phone before a full native build exists, which is most of the
   * development cycle.
   *
   * Allowed **only outside production**. In production these patterns are
   * refused like any other unknown host: `exp://` carries an arbitrary IP, so
   * permitting it on the live API would be an open redirect with extra steps.
   */
  private static readonly DEV_RETURN_PATTERNS = [
    /^exp:\/\/[\w.:-]+\/--\//,        // Expo Go over LAN or tunnel
    /^exp\+[\w-]+:\/\//,               // Expo Go, custom-scheme form
    /^http:\/\/localhost:\d+\//,       // local web client
  ];

  static isAllowedNativeReturn(url: string | undefined | null): boolean {
    if (!url) return false;
    if (AuthService.NATIVE_RETURN_PREFIXES.some((p) => url.startsWith(p))) return true;

    // Outside production, or when explicitly switched on for device testing.
    if (env.NODE_ENV !== 'production' || env.ALLOW_DEV_OAUTH_RETURN) {
      return AuthService.DEV_RETURN_PATTERNS.some((re) => re.test(url));
    }
    return false;
  }

  /**
   * `returnTo` is stored with the state rather than passed through the
   * provider, because the provider's redirect_uri is registered in their
   * console and cannot vary per request. The state is already a server-side
   * record of this attempt, so it is the natural place to remember where the
   * attempt came from.
   */
  async issueOAuthState(provider: SocialProvider, returnTo?: string): Promise<string> {
    const state = generateToken(16);
    const safeReturn = AuthService.isAllowedNativeReturn(returnTo) ? returnTo : undefined;
    await redis.set(
      REDIS_KEYS.OAUTH_STATE_V2(state),
      JSON.stringify({ provider, at: Date.now(), returnTo: safeReturn }),
      { ex: OAUTH_STATE_TTL_SECONDS },
    );
    return state;
  }

  /**
   * Exchanges the authorization code for our own tokens.
   *
   * This used to call `supabaseAdmin.auth.exchangeCodeForSession(code)`, which
   * only redeems codes Supabase itself issued through its own OAuth proxy. The
   * authorize URL above is built against our client ids, so the code always
   * came from the provider directly and the exchange could never succeed —
   * social sign-in returned "Could not authenticate" for every provider. The
   * exchange now goes to the provider's own token endpoint.
   */
  async handleSocialOAuth(
    provider: SocialProvider,
    code: string,
    ip: string,
    userAgent: string,
  ): Promise<SocialSignInResult> {
    const cfg = SOCIAL_PROVIDERS[provider];
    if (!cfg) throw new AppError(`Unsupported provider: ${provider}`, 400);

    let profile: SocialProfile;
    try {
      const body = new URLSearchParams({
        [cfg.clientIdParam ?? 'client_id']: cfg.clientId,
        client_secret: cfg.clientSecret,
        code,
        grant_type:    'authorization_code',
        redirect_uri:  cfg.redirectUri,
      });

      const res = await fetch(cfg.tokenUrl, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
      });
      const payload = await res.json() as Record<string, any>;
      if (!res.ok) throw new Error(`token endpoint ${res.status}: ${JSON.stringify(payload).slice(0, 200)}`);

      // TikTok v2 nests the token one level down; the rest return it flat.
      const accessToken = payload.access_token ?? payload.data?.access_token;
      if (!accessToken) throw new Error('no access_token in token response');

      profile = await cfg.fetchProfile(accessToken, payload);
    } catch (err) {
      // The provider's own message is not safe to surface — it can echo the
      // client secret back in an error string.
      logger.error({ err, provider }, 'social oauth exchange failed');
      throw new UnauthorizedError(
        `Could not sign you in with ${provider}. Please try again or use email sign-in.`,
      );
    }

    if (!profile.providerId) {
      throw new UnauthorizedError(`${provider} did not return an account id. Please use email sign-in.`);
    }

    return this.upsertSocialUser(provider, profile, ip, userAgent);
  }

  /**
   * Finds or creates the account behind a social profile, then issues tokens.
   *
   * Matching is by provider identity first and email second. Instagram and
   * TikTok return no email at all, and Facebook omits it for phone-only
   * accounts, so an email-only lookup would create a duplicate account on
   * every one of that user's subsequent sign-ins.
   */
  private async upsertSocialUser(
    provider: SocialProvider,
    profile: SocialProfile,
    ip: string,
    userAgent: string,
  ): Promise<SocialSignInResult> {
    type UserRow = { id: string; email: string; plan: string; is_verified: boolean; status?: string };

    const { data: linked } = await supabaseAdmin
      .from('social_identities')
      .select('user_id')
      .eq('provider', provider)
      .eq('provider_user_id', profile.providerId)
      .maybeSingle();

    let user: UserRow | null = null;
    let isNewUser = false;

    if (linked?.user_id) {
      const { data } = await supabaseAdmin
        .from('users').select('id,email,plan,is_verified,status').eq('id', linked.user_id).maybeSingle();
      user = data as UserRow | null;
    }

    // Fall back to email only when the provider vouched for it. A provider
    // that hands back an unverified address would otherwise be a way to take
    // over any account by registering that address on the provider's side.
    if (!user && profile.email) {
      const { data } = await supabaseAdmin
        .from('users').select('id,email,plan,is_verified,status')
        .eq('email', profile.email.toLowerCase()).maybeSingle();
      user = data as UserRow | null;
    }

    if (!user) {
      // A placeholder address keeps the NOT NULL + UNIQUE constraint on
      // users.email satisfied for providers that never disclose one. It is
      // flagged by `needsEmail` so onboarding collects a real address, and it
      // is unroutable by construction so nothing is ever mailed into the void.
      const email = profile.email?.toLowerCase()
        ?? `${provider}_${profile.providerId}@social.omlivestream.invalid`;

      const { data: created, error: ce } = await supabaseAdmin
        .from('users')
        .insert({
          id: uuidv4(),
          email,
          full_name:        profile.fullName,
          avatar_url:       profile.avatarUrl,
          plan:             'free_trial',
          // Verified only when the provider actually confirmed an address.
          is_verified:      Boolean(profile.email),
          status:           'active',
          trial_started_at: new Date().toISOString(),
          trial_expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        })
        .select('id,email,plan,is_verified,status')
        .single();

      if (ce || !created) {
        logger.error({ err: ce, provider }, 'social signup insert failed');
        throw new AppError('Failed to create account', 500);
      }

      user      = created as UserRow;
      isNewUser = true;
    }

    const u = user!;
    if (u.status === 'banned')    throw new UnauthorizedError(`Account banned. Contact ${env.SUPPORT_EMAIL}`);
    if (u.status === 'suspended') throw new UnauthorizedError(`Account suspended. Contact ${env.SUPPORT_EMAIL}`);

    // Link the identity for next time. Idempotent on (provider, provider_user_id).
    await supabaseAdmin.from('social_identities').upsert({
      provider,
      provider_user_id: profile.providerId,
      user_id:          u.id,
      email:            profile.email,
      last_login_at:    new Date().toISOString(),
    }, { onConflict: 'provider,provider_user_id' });

    const needsEmail = u.email.endsWith('.invalid');

    if (isNewUser) {
      if (!needsEmail) {
        await emailSvc.sendWelcomeEmail(u.email).catch(() => { /* non-fatal */ });
        try {
          const { WaitlistService } = await import('../waitlist/waitlist.service');
          await new WaitlistService().grantWaitlistReward(u.email, u.id);
        } catch { /* non-fatal */ }
      }
      // When the address is a placeholder, the welcome mail and the waitlist
      // reward both wait for onboarding to collect the real one — matching on
      // a synthetic address would never find a waitlist entry anyway.
    }

    const tokens = await this.issueTokens(u.id, u.email, u.plan as Plan, ip, userAgent);
    await this.trackLogin(u.id, u.email, ip, userAgent, isNewUser);

    return { ...tokens, isNewUser, needsEmail };
  }

  /**
   * Parks a completed sign-in behind a short-lived, single-use ticket.
   *
   * The provider redirect lands on the API, but the tokens belong in the
   * browser's localStorage on the frontend origin. Putting them in the
   * redirect URL would write a refresh token into browser history, the
   * Referer header of the next request, and every proxy log in between. The
   * ticket is a random opaque id with a 2-minute life that buys exactly one
   * token pair.
   */
  async parkSocialResult(result: SocialSignInResult): Promise<string> {
    const ticket = generateToken(24);
    await redis.set(`oauth:ticket:${ticket}`, JSON.stringify(result), { ex: OAUTH_TICKET_TTL_SECONDS });
    return ticket;
  }

  /** Redeems a ticket exactly once. */
  async redeemSocialTicket(ticket: string): Promise<SocialSignInResult> {
    const key = `oauth:ticket:${ticket}`;
    const raw = await redis.get<unknown>(key);
    if (!raw) throw new UnauthorizedError('This sign-in has expired. Please try again.');
    await redis.del(key);

    /**
     * Upstash's REST client parses JSON on read; a TCP client does not.
     *
     * `parkSocialResult` stores this with JSON.stringify, so what comes back is
     * a string on one transport and an already-parsed object on the other.
     * Calling JSON.parse on the object stringifies it to "[object Object]" and
     * throws SyntaxError — which surfaced as a generic 500 at the last step of
     * every social sign-in, after the user had already approved at Google.
     *
     * Accepting both shapes makes this independent of which client is
     * configured, rather than working only on the transport it was written
     * against.
     */
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw) as SocialSignInResult;
      } catch {
        throw new UnauthorizedError('This sign-in could not be completed. Please try again.');
      }
    }
    return raw as SocialSignInResult;
  }

  // ══════════════════════════════════════════════════════════════
  //  CLAIMING A REAL EMAIL AFTER A SOCIAL SIGN-IN
  // ══════════════════════════════════════════════════════════════
  //
  // Instagram and TikTok disclose no email at any scope, and Facebook omits
  // it for phone-only accounts. Those accounts are created against a
  // placeholder `@social.omlivestream.invalid` address so the NOT NULL +
  // UNIQUE constraint on users.email still holds. Nothing can be mailed to
  // them — not the OTP fallback, not a receipt, not a password-free login
  // link — until a real address is attached here.
  //
  // The address is verified with the same OTP machinery as email sign-in
  // rather than simply accepted: an unverified address on file is worse than
  // a placeholder, because it silently claims a mailbox the user may not own
  // and becomes a login route into their account.

  /** Sends a verification code to an address the user wants to attach. */
  async requestEmailClaim(userId: string, email: string): Promise<{ message: string }> {
    const normalised = email.toLowerCase().trim();

    const rateKey = REDIS_KEYS.OTP_RATE(`claim:${userId}`);
    const count   = await redis.incr(rateKey);
    if (count === 1) await redis.expire(rateKey, 3600);
    if (count > env.RATE_LIMIT_AUTH_MAX) {
      throw new TooManyRequestsError('Too many attempts — wait an hour before trying another address.');
    }

    const { data: taken } = await supabaseAdmin
      .from('users').select('id').eq('email', normalised).maybeSingle();
    if (taken && taken.id !== userId) {
      throw new AppError('That email is already used by another account.', 409, 'EMAIL_TAKEN');
    }

    await supabaseAdmin.from('otp_codes').delete().eq('user_id', userId).is('used_at', null);

    const otp = generateOtp(6);
    await supabaseAdmin.from('otp_codes').insert({
      id: uuidv4(), user_id: userId, code_hash: hashOtp(otp),
      type: 'login', attempts: 0,
      expires_at: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60_000).toISOString(),
      used_at: null,
    });

    // Sent to the address being claimed, not to the one on file — the one on
    // file is the placeholder and is undeliverable by design.
    await emailSvc.sendOtpEmail(normalised, otp, false);

    // Held in Redis, not in the OTP row, so a code intercepted for one
    // address cannot be redeemed against a different one.
    await redis.set(`email:claim:${userId}`, normalised, { ex: env.OTP_EXPIRY_MINUTES * 60 });

    return { message: `A ${env.OTP_EXPIRY_MINUTES}-minute verification code has been sent to ${normalised}` };
  }

  /** Confirms the code and swaps the placeholder address for the real one. */
  async confirmEmailClaim(userId: string, code: string): Promise<{ email: string }> {
    const pending = await redis.get<string>(`email:claim:${userId}`);
    if (!pending) throw new UnauthorizedError('That code has expired — request a new one.');

    const { data: otp } = await supabaseAdmin
      .from('otp_codes').select('*').eq('user_id', userId).is('used_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!otp) throw new UnauthorizedError('No active code — request a new one.');
    if (new Date(otp.expires_at) < new Date()) throw new UnauthorizedError('Code expired — request a new one.');
    if (otp.attempts >= env.OTP_MAX_ATTEMPTS) {
      await supabaseAdmin.from('otp_codes').delete().eq('id', otp.id);
      throw new TooManyRequestsError('Too many wrong attempts — request a new code.');
    }
    if (!safeCompare(hashOtp(code), otp.code_hash)) {
      await supabaseAdmin.from('otp_codes').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
      const remaining = env.OTP_MAX_ATTEMPTS - (otp.attempts + 1);
      throw new UnauthorizedError(`Incorrect code — ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining`);
    }

    await supabaseAdmin.from('otp_codes').update({ used_at: new Date().toISOString() }).eq('id', otp.id);

    // Re-checked immediately before the write: the address was free when the
    // code was sent, but an OTP window is minutes long and an email sign-up
    // in between would otherwise collide with the unique constraint.
    const { data: taken } = await supabaseAdmin
      .from('users').select('id').eq('email', pending).maybeSingle();
    if (taken && taken.id !== userId) {
      throw new AppError('That email was just claimed by another account.', 409, 'EMAIL_TAKEN');
    }

    const { error } = await supabaseAdmin
      .from('users').update({ email: pending, is_verified: true }).eq('id', userId);
    if (error) throw new AppError('Could not save that email address.', 500);

    await redis.del(`email:claim:${userId}`);

    // Deferred from signup: both were skipped while the address was a
    // placeholder, since a waitlist entry can only ever match a real one.
    await emailSvc.sendWelcomeEmail(pending).catch(() => { /* non-fatal */ });
    try {
      const { WaitlistService } = await import('../waitlist/waitlist.service');
      await new WaitlistService().grantWaitlistReward(pending, userId);
    } catch { /* non-fatal */ }

    return { email: pending };
  }

  // ══════════════════════════════════════════════════════════════
  //  TOKEN MANAGEMENT
  // ══════════════════════════════════════════════════════════════

  async refreshAccessToken(refreshToken: string): Promise<{ accessToken: string }> {
    let payload: { sub: string; email: string; plan: string };
    try {
      payload = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET) as typeof payload;
    } catch {
      throw new UnauthorizedError('Refresh token expired — please sign in again');
    }

    const { data: session } = await supabaseAdmin
      .from('sessions').select('id,expires_at')
      .eq('token_hash', sha256(refreshToken)).eq('user_id', payload.sub).maybeSingle();

    if (!session || new Date(session.expires_at) < new Date()) {
      throw new UnauthorizedError('Session expired — please sign in again');
    }

    // Keep last_seen_at fresh
    await supabaseAdmin.from('sessions')
      .update({ last_seen_at: new Date().toISOString() }).eq('id', session.id);

    const accessToken = jwt.sign(
      { sub: payload.sub, email: payload.email, plan: payload.plan },
      env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any }
    );
    return { accessToken };
  }

  async logout(userId: string, refreshToken: string): Promise<void> {
    await supabaseAdmin.from('sessions').delete()
      .eq('token_hash', sha256(refreshToken)).eq('user_id', userId);
  }

  async listSessions(userId: string) {
    const { data } = await supabaseAdmin
      .from('sessions')
      .select('id,ip_address,user_agent,last_seen_at,created_at,expires_at')
      .eq('user_id', userId).gt('expires_at', new Date().toISOString())
      .order('last_seen_at', { ascending: false });
    return data ?? [];
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await supabaseAdmin.from('sessions').delete().eq('user_id', userId);
  }

  // ══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ══════════════════════════════════════════════════════════════

  private async issueTokens(
    userId: string, email: string, plan: Plan, ip: string, userAgent: string
  ): Promise<TokenPair> {
    const accessToken  = jwt.sign({ sub: userId, email, plan }, env.JWT_SECRET,         { expiresIn: env.JWT_EXPIRES_IN as any });
    const refreshToken = jwt.sign({ sub: userId, email, plan }, env.JWT_REFRESH_SECRET, { expiresIn: env.JWT_REFRESH_EXPIRES_IN as any });

    await supabaseAdmin.from('sessions').insert({
      id: uuidv4(), user_id: userId,
      token_hash:   sha256(refreshToken),
      ip_address:   ip,
      user_agent:   userAgent,
      last_seen_at: new Date().toISOString(),
      expires_at:   new Date(Date.now() + 7 * 86_400_000).toISOString(),
    });

    return { accessToken, refreshToken };
  }

  /** Track login device — sends new-device alert email if unrecognised */
  private async trackLogin(
    userId: string, email: string, ip: string, userAgent: string, isNewUser: boolean
  ): Promise<void> {
    try {
      const fp = deviceFingerprint(userAgent, ip);

      const { data: prior } = await supabaseAdmin
        .from('login_logs').select('id').eq('user_id', userId)
        .eq('device_fingerprint', fp).limit(1).maybeSingle();

      const isNewDevice = !prior && !isNewUser;
      const riskLevel   = isNewDevice ? 'medium' : 'low';

      await supabaseAdmin.from('login_logs').insert({
        id: uuidv4(), user_id: userId,
        ip_address: ip, user_agent: userAgent,
        device_fingerprint: fp,
        is_new_device: isNewDevice,
        risk_level:    riskLevel,
        created_at:    new Date().toISOString(),
      });

      if (isNewDevice) {
        await emailSvc.sendNewDeviceLoginEmail(email, {
          ip, userAgent,
          time: new Date().toLocaleString('en-NG', { timeZone: 'Africa/Lagos' }),
        });
      }
    } catch {
      // Never block login due to tracking failure
    }
  }
}