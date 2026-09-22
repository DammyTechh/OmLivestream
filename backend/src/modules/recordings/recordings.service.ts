import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../../config/supabase';
import { NotFoundError, AppError, PremiumRequiredError } from '../../utils/errors';
import { videoEditQueue, videoPublishQueue } from '../../jobs/queues';
import type { Platform } from '../../types/database';

/**
 * A filename someone can recognise in their downloads folder.
 *
 * Every recording is stored as `recording.mp4`, so without this a creator ends
 * up with recording.mp4, recording(1).mp4, recording(2).mp4 and no way to tell
 * which broadcast is which. Using the stream title and date fixes that.
 *
 * Stripped to a conservative character set because this ends up in a
 * Content-Disposition header, where quotes, semicolons and newlines can
 * truncate the filename or worse.
 */
function downloadName(row: { streams?: { title?: string | null } | null; created_at?: string }): string {
  const title = row.streams?.title?.trim() || 'recording';
  const date  = (row.created_at ?? '').slice(0, 10);
  const safe  = title
    .replace(/[^\p{L}\p{N}\s._-]/gu, '')   // letters, numbers, space, dot, underscore, hyphen
    .replace(/\s+/g, '-')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '') || 'recording';
  return date ? `${safe}-${date}.mp4` : `${safe}.mp4`;
}


export class RecordingsService {
  async list(userId: string, page = 1, limit = 20) {
    const { data, error, count } = await supabaseAdmin.from('recordings')
      .select('*,streams(title,started_at)', { count: 'exact' })
      .eq('user_id', userId).order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;

    /**
     * Sign every row here, not just in `get`.
     *
     * `file_url` holds the value `getPublicUrl` produced at upload time, and
     * the recordings bucket is private — so following it returns
     * `{"statusCode":"404","error":"Bucket not found"}`. The list page's
     * download and play buttons used that URL directly, which is why they
     * 404'd on a recording that had uploaded perfectly well.
     *
     * Signing in the list costs one call per row and makes every button on
     * the page work without the client needing to fetch each recording
     * individually first.
     */
    const rows = await Promise.all((data ?? []).map(async (r) => {
      let signedUrl: string | null = null;
      let downloadUrl: string | null = null;
      if (r.file_url && r.status === 'ready') {
        const storagePath = String(r.file_url).split('/recordings/')[1];
        if (storagePath) {
          const [play, dl] = await Promise.all([
            // For the inline player: plays in the page.
            supabaseAdmin.storage.from('recordings')
              // An hour — long enough to watch or download a full broadcast,
              // short enough that a copied link does not stay live for ever.
              .createSignedUrl(storagePath, 3600),
            /**
             * For the download button.
             *
             * HTML's `download` attribute is ignored cross-origin, and storage
             * is a different origin — so the browser navigated to the file and
             * played it instead of saving it. Passing `download` makes Supabase
             * send `Content-Disposition: attachment`, which the browser must
             * honour whatever the origin.
             *
             * The filename is set here too, so the saved file is not called
             * "recording.mp4" for every broadcast the user has ever made.
             */
            supabaseAdmin.storage.from('recordings')
              .createSignedUrl(storagePath, 3600, { download: downloadName(r) }),
          ]);
          signedUrl   = play.data?.signedUrl ?? null;
          downloadUrl = dl.data?.signedUrl ?? null;
        }
      }
      return { ...r, signedUrl, downloadUrl };
    }));

    return { data: rows, total: count ?? 0 };
  }

  async get(userId: string, recordingId: string) {
    const { data, error } = await supabaseAdmin.from('recordings')
      .select('*,streams(title,started_at,ended_at)')
      .eq('id', recordingId).eq('user_id', userId).single();
    if (error || !data) throw new NotFoundError('Recording');

    let signedUrl: string | null = null;
    let downloadUrl: string | null = null;
    if (data.file_url && data.status === 'ready') {
      const storagePath = data.file_url.split('/recordings/')[1];
      if (storagePath) {
        const [play, dl] = await Promise.all([
          supabaseAdmin.storage.from('recordings').createSignedUrl(storagePath, 3600),
          // See downloadName above: forces a save rather than playback.
          supabaseAdmin.storage.from('recordings')
            .createSignedUrl(storagePath, 3600, { download: downloadName(data) }),
        ]);
        signedUrl   = play.data?.signedUrl ?? null;
        downloadUrl = dl.data?.signedUrl ?? null;
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