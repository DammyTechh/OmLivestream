/**
 * Sign-in OAuth providers.
 * ─────────────────────────────────────────────────────────────────
 * One table describing how to start a sign-in and how to finish it, so the
 * authorize URL and the token exchange can never drift apart — previously the
 * URL was built by hand per provider while the exchange went through
 * `supabase.auth.exchangeCodeForSession()`, which only understands codes
 * Supabase itself issued. A code minted by Google against our own client id
 * was never redeemable that way, so social sign-in could not complete for any
 * provider.
 *
 * Sign-in clients are deliberately distinct from the broadcast clients in
 * `platforms.service.ts`. Those carry publishing scopes; these ask only for a
 * name, an email and an avatar. Each falls back to its broadcast counterpart
 * so an existing deployment keeps working before the dedicated apps exist.
 */

import { env } from '../../config/env';

export type SocialProvider = 'google' | 'facebook' | 'instagram' | 'tiktok' | 'twitch';

/** What a provider tells us about the person signing in. */
export interface SocialProfile {
  /** Provider's own stable user id. Survives an email change; the email does not. */
  providerId: string;
  email:      string | null;
  fullName:   string | null;
  avatarUrl:  string | null;
}

interface ProviderConfig {
  authUrl:      string;
  tokenUrl:     string;
  clientId:     string;
  clientSecret: string;
  redirectUri:  string;
  scopes:       string[];
  /** Extra authorize-URL params (Google needs these to return a refresh token). */
  extra?:       Record<string, string>;
  /** TikTok is the odd one out: it wants `client_key`, not `client_id`. */
  clientIdParam?: string;
  /** Fetch the profile once an access token is in hand. */
  fetchProfile: (accessToken: string, tokenPayload: Record<string, any>) => Promise<SocialProfile>;
}

const base = env.API_BASE_URL.replace(/\/$/, '');
/** Sign-in callbacks, distinct from the `/platforms/oauth/callback/*` family. */
export const socialRedirectUri = (p: SocialProvider) => `${base}/api/v1/auth/social/${p}/callback`;

/** Small typed fetch helper — avoids an axios import for four call sites. */
async function getJson(url: string, headers: Record<string, string>): Promise<any> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
  return res.json();
}

export const SOCIAL_PROVIDERS: Record<SocialProvider, ProviderConfig> = {
  google: {
    authUrl:      'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl:     'https://oauth2.googleapis.com/token',
    clientId:     env.AUTH_GOOGLE_CLIENT_ID     ?? env.YOUTUBE_CLIENT_ID,
    clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET ?? env.YOUTUBE_CLIENT_SECRET,
    redirectUri:  socialRedirectUri('google'),
    scopes:       ['openid', 'profile', 'email'],
    // `prompt: consent` so a user who revoked access can grant it again
    // instead of bouncing straight back with a code we cannot use.
    extra:        { access_type: 'offline', prompt: 'consent' },
    async fetchProfile(accessToken) {
      const p = await getJson('https://www.googleapis.com/oauth2/v3/userinfo', {
        Authorization: `Bearer ${accessToken}`,
      });
      return {
        providerId: String(p.sub),
        // Unverified Google addresses are rejected upstream: treating one as
        // proof of ownership would let anyone claim an existing account.
        email:      p.email_verified ? (p.email ?? null) : null,
        fullName:   p.name ?? null,
        avatarUrl:  p.picture ?? null,
      };
    },
  },

  facebook: {
    authUrl:      'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl:     'https://graph.facebook.com/v19.0/oauth/access_token',
    clientId:     env.AUTH_FACEBOOK_CLIENT_ID     ?? env.META_APP_ID,
    clientSecret: env.AUTH_FACEBOOK_CLIENT_SECRET ?? env.META_APP_SECRET,
    redirectUri:  socialRedirectUri('facebook'),
    scopes:       ['email', 'public_profile'],
    async fetchProfile(accessToken) {
      const p = await getJson(
        `https://graph.facebook.com/v19.0/me?fields=${encodeURIComponent('id,name,email,picture.type(large)')}`,
        { Authorization: `Bearer ${accessToken}` },
      );
      return {
        providerId: String(p.id),
        // Facebook omits `email` entirely for phone-number-only accounts, so
        // this is null far more often than the permission suggests.
        email:      p.email ?? null,
        fullName:   p.name ?? null,
        avatarUrl:  p.picture?.data?.url ?? null,
      };
    },
  },

  instagram: {
    authUrl:      'https://api.instagram.com/oauth/authorize',
    tokenUrl:     'https://api.instagram.com/oauth/access_token',
    clientId:     env.AUTH_INSTAGRAM_CLIENT_ID     ?? env.META_APP_ID,
    clientSecret: env.AUTH_INSTAGRAM_CLIENT_SECRET ?? env.META_APP_SECRET,
    redirectUri:  socialRedirectUri('instagram'),
    scopes:       ['user_profile'],
    async fetchProfile(accessToken, payload) {
      const id = payload.user_id ? String(payload.user_id) : null;
      const p  = await getJson(
        `https://graph.instagram.com/me?fields=id,username&access_token=${encodeURIComponent(accessToken)}`,
        {},
      );
      return {
        providerId: String(p.id ?? id),
        // Instagram Basic Display returns no email at any scope. Sign-in
        // therefore lands on the email-collection step rather than failing.
        email:      null,
        fullName:   p.username ?? null,
        avatarUrl:  null,
      };
    },
  },

  tiktok: {
    authUrl:       'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl:      'https://open.tiktokapis.com/v2/oauth/token/',
    clientId:      env.AUTH_TIKTOK_CLIENT_KEY    ?? env.TIKTOK_CLIENT_KEY,
    clientSecret:  env.AUTH_TIKTOK_CLIENT_SECRET ?? env.TIKTOK_CLIENT_SECRET,
    redirectUri:   socialRedirectUri('tiktok'),
    scopes:        ['user.info.basic'],
    clientIdParam: 'client_key',
    async fetchProfile(accessToken) {
      const p = await getJson(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url',
        { Authorization: `Bearer ${accessToken}` },
      );
      const u = p.data?.user ?? {};
      return {
        providerId: String(u.open_id),
        email:      null,   // TikTok exposes no email to third parties.
        fullName:   u.display_name ?? null,
        avatarUrl:  u.avatar_url ?? null,
      };
    },
  },

  twitch: {
    authUrl:      'https://id.twitch.tv/oauth2/authorize',
    tokenUrl:     'https://id.twitch.tv/oauth2/token',
    clientId:     env.AUTH_TWITCH_CLIENT_ID     ?? env.TWITCH_CLIENT_ID,
    clientSecret: env.AUTH_TWITCH_CLIENT_SECRET ?? env.TWITCH_CLIENT_SECRET,
    redirectUri:  socialRedirectUri('twitch'),
    scopes:       ['user:read:email'],
    async fetchProfile(accessToken) {
      const p = await getJson('https://api.twitch.tv/helix/users', {
        Authorization: `Bearer ${accessToken}`,
        // Helix rejects a bearer token without the matching client id.
        'Client-Id':   env.AUTH_TWITCH_CLIENT_ID ?? env.TWITCH_CLIENT_ID,
      });
      const u = p.data?.[0] ?? {};
      return {
        providerId: String(u.id),
        email:      u.email ?? null,
        fullName:   u.display_name ?? u.login ?? null,
        avatarUrl:  u.profile_image_url ?? null,
      };
    },
  },
};

/** True when a provider has usable credentials — drives the buttons the UI shows. */
export function isProviderConfigured(p: SocialProvider): boolean {
  const c = SOCIAL_PROVIDERS[p];
  return Boolean(c.clientId && c.clientSecret);
}
