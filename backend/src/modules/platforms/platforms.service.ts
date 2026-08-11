import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { encrypt, decrypt } from '../../utils/crypto';
import { env } from '../../config/env';
import { NotFoundError, ValidationError, AppError } from '../../utils/errors';
import { logger } from '../../config/logger';
import type { Platform } from '../../types/database';

const OAUTH: Record<string, { authUrl: string; tokenUrl: string; clientId: string; clientSecret: string; redirectUri: string; scopes: string[] }> = {
  youtube:   { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',      tokenUrl: 'https://oauth2.googleapis.com/token',                        clientId: env.YOUTUBE_CLIENT_ID,   clientSecret: env.YOUTUBE_CLIENT_SECRET,   redirectUri: env.YOUTUBE_REDIRECT_URI,   scopes: ['https://www.googleapis.com/auth/youtube.force-ssl','https://www.googleapis.com/auth/youtube.upload'] },
  facebook:  { authUrl: 'https://www.facebook.com/v19.0/dialog/oauth',       tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',         clientId: env.META_APP_ID,         clientSecret: env.META_APP_SECRET,         redirectUri: env.FACEBOOK_REDIRECT_URI,  scopes: ['publish_video','pages_manage_posts','pages_read_engagement'] },
  instagram: { authUrl: 'https://api.instagram.com/oauth/authorize',          tokenUrl: 'https://api.instagram.com/oauth/access_token',                clientId: env.META_APP_ID,         clientSecret: env.META_APP_SECRET,         redirectUri: env.INSTAGRAM_REDIRECT_URI, scopes: ['instagram_basic','instagram_content_publish'] },
  twitch:    { authUrl: 'https://id.twitch.tv/oauth2/authorize',              tokenUrl: 'https://id.twitch.tv/oauth2/token',                           clientId: env.TWITCH_CLIENT_ID,    clientSecret: env.TWITCH_CLIENT_SECRET,    redirectUri: env.TWITCH_REDIRECT_URI,    scopes: ['channel:manage:broadcast','user:read:broadcast','chat:read','chat:edit'] },
  tiktok:    { authUrl: 'https://www.tiktok.com/auth/authorize/',             tokenUrl: 'https://open-api.tiktok.com/oauth/access_token/',             clientId: env.TIKTOK_CLIENT_KEY,   clientSecret: env.TIKTOK_CLIENT_SECRET,   redirectUri: env.TIKTOK_REDIRECT_URI,    scopes: ['user.info.basic','live.write','video.publish'] },
  twitter:   { authUrl: 'https://twitter.com/i/oauth2/authorize',             tokenUrl: 'https://api.twitter.com/2/oauth2/token',                      clientId: env.TWITTER_CLIENT_ID,   clientSecret: env.TWITTER_CLIENT_SECRET,   redirectUri: env.TWITTER_REDIRECT_URI,   scopes: ['tweet.read','tweet.write','users.read','offline.access'] },
  linkedin:  { authUrl: 'https://www.linkedin.com/oauth/v2/authorization',   tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',               clientId: env.LINKEDIN_CLIENT_ID,  clientSecret: env.LINKEDIN_CLIENT_SECRET,  redirectUri: env.LINKEDIN_REDIRECT_URI,  scopes: ['w_member_social','r_basicprofile'] },
};

const RTMP_ENDPOINTS: Partial<Record<Platform, string>> = {
  youtube:  'rtmp://a.rtmp.youtube.com/live2',
  twitch:   'rtmp://live.twitch.tv/live',
  kick:     'rtmp://ingest.kick.com/live',
  facebook: 'rtmps://live-api-s.facebook.com:443/rtmp',
};

export class PlatformsService {
  async listConnections(userId: string) {
    const { data, error } = await supabaseAdmin.from('platform_connections')
      .select('id,platform,status,platform_username,rtmp_url,connected_at,updated_at')
      .eq('user_id', userId).order('connected_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  getOAuthUrl(platform: Platform, state: string): string {
    const cfg = OAUTH[platform];
    if (!cfg) throw new ValidationError(`${platform} does not support OAuth`);
    const params = new URLSearchParams({
      client_id: cfg.clientId, redirect_uri: cfg.redirectUri,
      response_type: 'code', scope: cfg.scopes.join(' '), state, access_type: 'offline',
    });
    return `${cfg.authUrl}?${params}`;
  }

  async handleOAuthCallback(platform: Platform, code: string, userId: string): Promise<void> {
    const cfg = OAUTH[platform];
    if (!cfg) throw new ValidationError(`Unsupported OAuth platform: ${platform}`);

    const tokenResp = await axios.post(cfg.tokenUrl, new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri, grant_type: 'authorization_code', code,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token, refresh_token } = tokenResp.data;
    if (!access_token) throw new AppError(`No access token from ${platform}`, 502);

    const details = await this.fetchStreamDetails(platform, access_token);
    await this.upsert(userId, platform, { access_token, refresh_token, ...details, status: 'connected' });
  }

  async connectManual(userId: string, platform: Platform, rtmpUrl: string, streamKey: string): Promise<void> {
    await this.upsert(userId, platform, { access_token: null, refresh_token: null, rtmpUrl, streamKey, platformUserId: null, platformUsername: null, status: 'connected' });
  }

  async disconnect(userId: string, id: string): Promise<void> {
    await supabaseAdmin.from('platform_connections').delete().eq('id', id).eq('user_id', userId);
  }

  /**
   * Opens a fresh live session on a platform for one specific broadcast.
   *
   * This is deliberately separate from getStreamCredentials(). The RTMP
   * endpoint and key can be long-lived, but the *live session* — YouTube's
   * liveBroadcast, Facebook's live video — cannot: each is single-use, and
   * each carries the chat handle we need in order to read comments.
   * Creating them at OAuth-connect time (as fetchStreamDetails does) yields
   * an object that is already dead by the time the user actually streams.
   *
   * Returns null when the platform has no such concept, or when the call
   * fails — a platform that cannot open a chat session should still receive
   * video, so callers treat this as best-effort.
   */
  async openLiveSession(userId: string, platform: Platform, title: string): Promise<{
    liveChatId?:  string;
    liveVideoId?: string;
    rtmpUrl?:     string;
    streamKey?:   string;
  } | null> {
    const { data } = await supabaseAdmin.from('platform_connections')
      .select('access_token_encrypted,status').eq('user_id', userId).eq('platform', platform).single();
    if (!data?.access_token_encrypted || data.status !== 'connected') return null;

    let token: string;
    try { token = decrypt(data.access_token_encrypted); }
    catch (err) { logger.error({ err, platform }, 'Could not decrypt token for live session'); return null; }

    try {
      if (platform === 'youtube') return await this.openYouTubeSession(token, title);
      if (platform === 'facebook') return await this.openFacebookSession(token, title);
    } catch (err) {
      logger.warn(
        { err: (err as { response?: { data?: unknown } })?.response?.data ?? err, platform },
        'Could not open live session — streaming video only, no comment feed'
      );
    }
    return null;
  }

  /**
   * YouTube needs three calls, not one.
   *
   * A liveStream is only an ingestion endpoint — it has no chat and is not
   * publicly visible. What viewers watch, and what owns the live chat, is a
   * liveBroadcast. The two are separate objects and must be explicitly
   * bound. Creating just the liveStream (which is all fetchStreamDetails
   * did) produces a key that accepts video nobody can see.
   */
  private async openYouTubeSession(token: string, title: string) {
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    const broadcast = await axios.post(
      'https://www.googleapis.com/youtube/v3/liveBroadcasts',
      {
        snippet: { title, scheduledStartTime: new Date().toISOString() },
        status:  { privacyStatus: 'public', selfDeclaredMadeForKids: false },
        // Without autoStart the broadcast sits in 'ready' until it is
        // transitioned manually, so the ingested video never goes live.
        contentDetails: { enableAutoStart: true, enableAutoStop: true },
      },
      { ...auth, params: { part: 'snippet,status,contentDetails' } }
    );

    const stream = await axios.post(
      'https://www.googleapis.com/youtube/v3/liveStreams',
      { snippet: { title }, cdn: { frameRate: 'variable', ingestionType: 'rtmp', resolution: 'variable' } },
      { ...auth, params: { part: 'snippet,cdn' } }
    );

    await axios.post(
      'https://www.googleapis.com/youtube/v3/liveBroadcasts/bind',
      null,
      { ...auth, params: { id: broadcast.data.id, streamId: stream.data.id, part: 'id,contentDetails' } }
    );

    return {
      liveChatId: broadcast.data?.snippet?.liveChatId as string | undefined,
      // The liveBroadcast id is also the watch-page video id, which is what
      // videos.list wants in order to report concurrentViewers while the
      // broadcast runs and viewCount after it ends. Returned under the same
      // name Facebook uses so callers have one field to read, not two.
      liveVideoId: broadcast.data?.id as string | undefined,
      rtmpUrl:    RTMP_ENDPOINTS.youtube!,
      streamKey:  stream.data?.cdn?.ingestionInfo?.streamName as string | undefined,
    };
  }

  private async openFacebookSession(token: string, title: string) {
    const r = await axios.post(
      'https://graph.facebook.com/v19.0/me/live_videos',
      { status: 'LIVE_NOW', title },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const url: string = r.data?.stream_url ?? '';
    const parts = url.split('/');
    const key = parts.pop();
    return {
      liveVideoId: r.data?.id as string | undefined,
      rtmpUrl:     parts.join('/') || RTMP_ENDPOINTS.facebook!,
      streamKey:   key || undefined,
    };
  }

  async reconnect(userId: string, id: string): Promise<void> {
    const { data: conn } = await supabaseAdmin.from('platform_connections')
      .select('*').eq('id', id).eq('user_id', userId).single();
    if (!conn) throw new NotFoundError('Platform connection');
    if (!conn.refresh_token_encrypted) throw new ValidationError('No refresh token — please reconnect');

    const cfg = OAUTH[conn.platform];
    if (!cfg) throw new ValidationError(`Cannot refresh tokens for ${conn.platform}`);

    const resp = await axios.post(cfg.tokenUrl, new URLSearchParams({
      client_id: cfg.clientId, client_secret: cfg.clientSecret,
      grant_type: 'refresh_token', refresh_token: decrypt(conn.refresh_token_encrypted),
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const { access_token, refresh_token } = resp.data;
    await supabaseAdmin.from('platform_connections').update({
      access_token_encrypted: encrypt(access_token),
      ...(refresh_token ? { refresh_token_encrypted: encrypt(refresh_token) } : {}),
      status: 'connected', updated_at: new Date().toISOString(),
    }).eq('id', id);
  }

  /** Internal only — decrypts credentials for RTMP relay. Never sent to client. */
  async getStreamCredentials(userId: string, platform: Platform): Promise<{ rtmpUrl: string; streamKey: string }> {
    const { data } = await supabaseAdmin.from('platform_connections')
      .select('rtmp_url,stream_key_encrypted,status').eq('user_id', userId).eq('platform', platform).single();
    if (!data || data.status !== 'connected') throw new AppError(`${platform} not connected`, 400, 'PLATFORM_NOT_CONNECTED');
    if (!data.rtmp_url || !data.stream_key_encrypted) throw new AppError(`${platform} missing RTMP credentials`, 400);
    return { rtmpUrl: data.rtmp_url, streamKey: decrypt(data.stream_key_encrypted) };
  }

  private async fetchStreamDetails(platform: Platform, token: string): Promise<{ rtmpUrl: string | null; streamKey: string | null; platformUserId: string | null; platformUsername: string | null }> {
    try {
      if (platform === 'youtube') {
        const r = await axios.post('https://www.googleapis.com/youtube/v3/liveStreams',
          { snippet: { title: 'OmliveStream' }, cdn: { frameRate: '60fps', ingestionType: 'rtmp', resolution: '1080p' } },
          { headers: { Authorization: `Bearer ${token}` }, params: { part: 'snippet,cdn' } });
        return { rtmpUrl: RTMP_ENDPOINTS.youtube!, streamKey: r.data?.cdn?.ingestionInfo?.streamName ?? null, platformUserId: null, platformUsername: null };
      }
      if (platform === 'twitch') {
        const u = await axios.get('https://api.twitch.tv/helix/users', { headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.TWITCH_CLIENT_ID } });
        const user = u.data?.data?.[0];
        const k = await axios.get('https://api.twitch.tv/helix/streams/key', { headers: { Authorization: `Bearer ${token}`, 'Client-Id': env.TWITCH_CLIENT_ID }, params: { broadcaster_id: user?.id } });
        return { rtmpUrl: RTMP_ENDPOINTS.twitch!, streamKey: k.data?.data?.[0]?.stream_key ?? null, platformUserId: user?.id ?? null, platformUsername: user?.login ?? null };
      }
      if (platform === 'facebook') {
        const r = await axios.post('https://graph.facebook.com/v19.0/me/live_videos', { status: 'LIVE_NOW', title: 'OmliveStream' }, { headers: { Authorization: `Bearer ${token}` } });
        const url: string = r.data?.stream_url ?? '';
        const parts = url.split('/'); const key = parts.pop();
        return { rtmpUrl: parts.join('/') || RTMP_ENDPOINTS.facebook!, streamKey: key ?? null, platformUserId: r.data?.id ?? null, platformUsername: null };
      }
    } catch { /* non-fatal — user can enter manually */ }
    return { rtmpUrl: RTMP_ENDPOINTS[platform] ?? null, streamKey: null, platformUserId: null, platformUsername: null };
  }

  private async upsert(userId: string, platform: Platform, d: { access_token: string | null; refresh_token: string | null; rtmpUrl?: string | null; streamKey?: string | null; platformUserId?: string | null; platformUsername?: string | null; status: string }): Promise<void> {
    await supabaseAdmin.from('platform_connections').upsert({
      id: uuidv4(), user_id: userId, platform,
      access_token_encrypted:  d.access_token  ? encrypt(d.access_token)  : null,
      refresh_token_encrypted: d.refresh_token ? encrypt(d.refresh_token) : null,
      rtmp_url:           d.rtmpUrl ?? null,
      stream_key_encrypted: d.streamKey ? encrypt(d.streamKey) : null,
      platform_user_id:   d.platformUserId ?? null,
      platform_username:  d.platformUsername ?? null,
      status:             d.status,
      updated_at:         new Date().toISOString(),
    }, { onConflict: 'user_id,platform' });
  }
}
