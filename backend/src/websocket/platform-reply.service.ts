import axios from 'axios';
import { supabaseAdmin } from '../config/supabase';
import { decrypt } from '../utils/crypto';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

/** Platforms whose live-chat APIs allow posting a reply back. */
export const REPLY_CAPABLE = ['youtube', 'facebook', 'instagram', 'twitch'] as const;

export class PlatformReplyService {
  /**
   * Posts a reply to a live comment on its source platform.
   *
   * `commentId` is the platform's own identifier, captured at ingestion:
   *   youtube   → liveChatId (replies post a new chat message, not a thread)
   *   facebook  → comment object id
   *   instagram → comment object id
   *   twitch    → broadcaster user id (chat is a flat room, not threaded)
   */
  async sendReply(
    userId: string,
    platform: string,
    commentId: string,
    replyText: string
  ): Promise<void> {
    const { data: conn } = await supabaseAdmin
      .from('platform_connections')
      .select('access_token_encrypted,status,platform_user_id')
      .eq('user_id', userId).eq('platform', platform).single();

    if (!conn || conn.status !== 'connected') throw new AppError(`${platform} not connected`, 400);
    if (!conn.access_token_encrypted) throw new AppError(`No access token for ${platform}`, 400);

    const token = decrypt(conn.access_token_encrypted);
    // 10s ceiling — a hung platform API must not hold a socket handler open.
    const cfg = { timeout: 10_000 };

    try {
      switch (platform) {
        case 'youtube':
          // Live chat is not threaded: a "reply" is a new message in the
          // same live chat, so commentId here is the liveChatId.
          await axios.post(
            'https://www.googleapis.com/youtube/v3/liveChat/messages',
            {
              snippet: {
                liveChatId: commentId,
                type: 'textMessageEvent',
                textMessageDetails: { messageText: replyText },
              },
            },
            { ...cfg, headers: { Authorization: `Bearer ${token}` }, params: { part: 'snippet' } }
          );
          break;

        case 'facebook':
          await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/comments`,
            { message: replyText },
            { ...cfg, headers: { Authorization: `Bearer ${token}` } }
          );
          break;

        case 'instagram':
          await axios.post(
            `https://graph.facebook.com/v19.0/${commentId}/replies`,
            { message: replyText },
            { ...cfg, headers: { Authorization: `Bearer ${token}` } }
          );
          break;

        case 'twitch':
          // Twitch chat is a flat room; commentId carries the broadcaster id.
          await axios.post(
            'https://api.twitch.tv/helix/chat/messages',
            {
              broadcaster_id: commentId,
              sender_id:      conn.platform_user_id,
              message:        replyText,
            },
            {
              ...cfg,
              headers: {
                Authorization:  `Bearer ${token}`,
                'Client-Id':    env.TWITCH_CLIENT_ID,
                'Content-Type': 'application/json',
              },
            }
          );
          break;

        default:
          throw new AppError(
            `${platform} does not offer a public API for posting live-chat replies`,
            400,
            'REPLY_UNSUPPORTED'
          );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;

      // Surface the platform's own message — "token expired" and
      // "rate limited" need different user action, and a bare 500 hides that.
      const ax = err as { response?: { status?: number; data?: unknown } };
      const status = ax.response?.status;

      if (status === 401 || status === 403) {
        throw new AppError(
          `Your ${platform} connection has expired. Reconnect it in Settings.`,
          401,
          'PLATFORM_TOKEN_EXPIRED'
        );
      }
      if (status === 429) {
        throw new AppError(
          `${platform} is rate limiting replies. Wait a moment before trying again.`,
          429,
          'PLATFORM_RATE_LIMITED'
        );
      }
      throw new AppError(`Could not post reply to ${platform}`, 502, 'PLATFORM_REPLY_FAILED');
    }
  }
}
