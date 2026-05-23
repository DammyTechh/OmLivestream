import axios from 'axios';
import { supabaseAdmin } from '../config/supabase';
import { decrypt } from '../utils/crypto';
import { env } from '../config/env';
import { AppError } from '../utils/errors';

export class PlatformReplyService {
  async sendReply(userId: string, platform: string, commentId: string, replyText: string): Promise<void> {
    const { data: conn } = await supabaseAdmin
      .from('platform_connections')
      .select('access_token_encrypted,status')
      .eq('user_id', userId).eq('platform', platform).single();

    if (!conn || conn.status !== 'connected') throw new AppError(`${platform} not connected`, 400);
    if (!conn.access_token_encrypted) throw new AppError(`No access token for ${platform}`, 400);

    const token = decrypt(conn.access_token_encrypted);

    switch (platform) {
      case 'youtube':
        await axios.post('https://www.googleapis.com/youtube/v3/comments',
          { snippet: { parentId: commentId, textOriginal: replyText } },
          { headers: { Authorization: `Bearer ${token}` }, params: { part: 'snippet' } });
        break;
      case 'facebook':
        await axios.post(`https://graph.facebook.com/v19.0/${commentId}/comments`,
          { message: replyText }, { headers: { Authorization: `Bearer ${token}` } });
        break;
      case 'instagram':
        await axios.post(`https://graph.facebook.com/v19.0/${commentId}/replies`,
          { message: replyText }, { headers: { Authorization: `Bearer ${token}` } });
        break;
      default:
        throw new AppError(`Comment replies not yet supported for ${platform}`, 400);
    }
  }
}
