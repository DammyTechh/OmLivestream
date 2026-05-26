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
 *    1. GET  /auth/social/:provider/url  → redirectUrl
 *    2. POST /auth/social/:provider      { code } (after OAuth redirect)
 *    → { accessToken, refreshToken, isNewUser }
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
import { generateOtp, hashOtp, safeCompare, sha256 } from '../../utils/crypto';
import { UnauthorizedError, TooManyRequestsError, AppError } from '../../utils/errors';
import type { TokenPair, Plan } from '../../types/database';
import { EmailService } from '../email/email.service';

const emailSvc = new EmailService();

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
   * Returns the OAuth redirect URL for a given provider.
   * Frontend redirects user to this URL. Provider redirects back with ?code=...
   */
  getSocialOAuthUrl(
    provider: 'google' | 'facebook' | 'instagram' | 'tiktok' | 'twitch',
    state: string
  ): string {
    const configs: Record<string, { authUrl: string; clientId: string; redirectUri: string; scopes: string[]; extra?: Record<string, string> }> = {
      google: {
        authUrl:     'https://accounts.google.com/o/oauth2/v2/auth',
        clientId:    env.YOUTUBE_CLIENT_ID,
        redirectUri: `${env.API_BASE_URL}/api/v1/auth/social/google/callback`,
        scopes:      ['openid', 'profile', 'email'],
        extra:       { access_type: 'offline', prompt: 'consent' },
      },
      facebook: {
        authUrl:     'https://www.facebook.com/v19.0/dialog/oauth',
        clientId:    env.META_APP_ID,
        redirectUri: `${env.API_BASE_URL}/api/v1/auth/social/facebook/callback`,
        scopes:      ['email', 'public_profile'],
      },
      instagram: {
        authUrl:     'https://api.instagram.com/oauth/authorize',
        clientId:    env.META_APP_ID,
        redirectUri: `${env.API_BASE_URL}/api/v1/auth/social/instagram/callback`,
        scopes:      ['user_profile', 'user_media'],
      },
      tiktok: {
        authUrl:     'https://www.tiktok.com/auth/authorize/',
        clientId:    env.TIKTOK_CLIENT_KEY,
        redirectUri: `${env.API_BASE_URL}/api/v1/auth/social/tiktok/callback`,
        scopes:      ['user.info.basic'],
      },
      twitch: {
        authUrl:     'https://id.twitch.tv/oauth2/authorize',
        clientId:    env.TWITCH_CLIENT_ID,
        redirectUri: `${env.API_BASE_URL}/api/v1/auth/social/twitch/callback`,
        scopes:      ['user:read:email'],
      },
    };

    const cfg = configs[provider];
    if (!cfg) throw new AppError(`Unsupported provider: ${provider}`, 400);

    const params = new URLSearchParams({
      client_id:     cfg.clientId,
      redirect_uri:  cfg.redirectUri,
      response_type: 'code',
      scope:         cfg.scopes.join(' '),
      state,
      ...(cfg.extra ?? {}),
    });

    return `${cfg.authUrl}?${params.toString()}`;
  }

  /**
   * Exchange OAuth code for OmliveStream tokens.
   * Called from the frontend after the provider redirects with ?code=...
   */
  async handleSocialOAuth(
    provider: 'google' | 'facebook' | 'instagram' | 'tiktok' | 'twitch',
    code: string,
    ip: string,
    userAgent: string
  ): Promise<TokenPair & { isNewUser: boolean }> {
    // Exchange code for user profile via Supabase Auth (handles token exchange per provider)
    const { data, error } = await supabaseAdmin.auth.exchangeCodeForSession(code);

    if (error || !data.user?.email) {
      throw new UnauthorizedError(
        `Could not authenticate with ${provider}. Please try again or use email sign-in.`
      );
    }

    const email    = data.user.email;
    const fullName = (data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? '') as string;
    const avatar   = (data.user.user_metadata?.avatar_url ?? data.user.user_metadata?.picture ?? null) as string | null;

    // Upsert user
    let { data: user } = await supabaseAdmin
      .from('users').select('id,email,plan,is_verified,status').eq('email', email).maybeSingle();

    let isNewUser = false;
    if (!user) {
      const { data: created, error: ce } = await supabaseAdmin
        .from('users')
        .insert({
          id: uuidv4(), email,
          full_name:        fullName || null,
          avatar_url:       avatar,
          plan:             'free_trial',
          is_verified:      true,
          status:           'active',
          trial_started_at: new Date().toISOString(),
          trial_expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString(),
        })
        .select('id,email,plan,is_verified,status').single();
      if (ce || !created) throw new AppError('Failed to create account', 500);
      user = created;
      isNewUser = true;
      await emailSvc.sendWelcomeEmail(email);
      try {
        const { WaitlistService } = await import('../waitlist/waitlist.service');
        await new WaitlistService().grantWaitlistReward(email, user!.id);
      } catch { /* non-fatal */ }
    }

    const u2 = user!;
    if (u2.status === 'banned')    throw new UnauthorizedError('Account banned. Contact support@omlivestream.com');
    if (u2.status === 'suspended') throw new UnauthorizedError('Account suspended. Contact support@omlivestream.com');

    const tokens = await this.issueTokens(u2.id, u2.email, u2.plan as Plan, ip, userAgent);
    await this.trackLogin(u2.id, u2.email, ip, userAgent, isNewUser);

    return { ...tokens, isNewUser };
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