import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { NotFoundError, AppError, PremiumRequiredError } from '../../utils/errors';
import { videoEditQueue, videoPublishQueue } from '../../jobs/queues';
import type { Platform } from '../../types/database';

export class RecordingsService {
  async list(userId: string, page = 1, limit = 20) {
    const { data, error, count } = await supabaseAdmin.from('recordings')
      .select('*,streams(title,started_at)', { count: 'exact' })
      .eq('user_id', userId).order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  async get(userId: string, recordingId: string) {
    const { data, error } = await supabaseAdmin.from('recordings')
      .select('*,streams(title,started_at,ended_at)')
      .eq('id', recordingId).eq('user_id', userId).single();
    if (error || !data) throw new NotFoundError('Recording');

    let signedUrl: string | null = null;
    if (data.file_url && data.status === 'ready') {
      const storagePath = data.file_url.split('/recordings/')[1];
      if (storagePath) {
        const { data: urlData } = await supabaseAdmin.storage.from('recordings').createSignedUrl(storagePath, 3600);
        signedUrl = urlData?.signedUrl ?? null;
      }
    }
    return { ...data, signedUrl };
  }

  async delete(userId: string, recordingId: string): Promise<void> {
    const { data } = await supabaseAdmin.from('recordings')
      .select('id,file_url').eq('id', recordingId).eq('user_id', userId).single();
    if (!data) throw new NotFoundError('Recording');

    if (data.file_url) {
      const path = data.file_url.split('/recordings/')[1];
      if (path) await supabaseAdmin.storage.from('recordings').remove([path]);
    }
    await supabaseAdmin.from('recordings').delete().eq('id', recordingId);
  }

  async requestAiEdit(userId: string, recordingId: string, prompt: string, plan: string): Promise<{ jobId: string }> {
    if (plan !== 'premium') throw new PremiumRequiredError('AI video editing');

    const { data: rec } = await supabaseAdmin.from('recordings')
      .select('id,status,file_url').eq('id', recordingId).eq('user_id', userId).single();
    if (!rec) throw new NotFoundError('Recording');
    if (rec.status !== 'ready') throw new AppError('Recording must be ready before editing', 400);

    const editId = uuidv4();
    await supabaseAdmin.from('video_edits').insert({
      id: editId, recording_id: recordingId, user_id: userId,
      edit_type: 'ai', ai_prompt: prompt, status: 'pending', output_url: null,
    });

    const job = await videoEditQueue.add('ai-edit', { editId, recordingId, userId, prompt, fileUrl: rec.file_url });
    return { jobId: (job?.id ?? editId) as string };
  }

  async getEditStatus(userId: string, recordingId: string) {
    const { data } = await supabaseAdmin.from('video_edits')
      .select('id,status,output_url,created_at,updated_at')
      .eq('recording_id', recordingId).eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data;
  }

  async publish(userId: string, recordingId: string, platform: Platform, caption: string, scheduledAt?: string): Promise<void> {
    const { data: rec } = await supabaseAdmin.from('recordings')
      .select('id,status,file_url').eq('id', recordingId).eq('user_id', userId).single();
    if (!rec) throw new NotFoundError('Recording');
    if (rec.status !== 'ready') throw new AppError('Recording not ready', 400);

    await supabaseAdmin.from('video_publishes').insert({
      id: uuidv4(), recording_id: recordingId, user_id: userId,
      platform, caption, status: 'pending', scheduled_at: scheduledAt ?? null, published_at: null,
    });

    await videoPublishQueue.add('publish', { recordingId, userId, platform, caption, scheduledAt, fileUrl: rec.file_url });
  }
}