import 'dotenv/config';
import { Worker } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { createBullConnection } from '../config/redis';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { EmailService } from '../modules/email/email.service';
import { notifications } from '../modules/notifications/notifications.service';
import { logger } from '../config/logger';
import { completeJson } from '../modules/ai/ai.client';
import { z } from 'zod';

const email  = new EmailService();
const TMP = '/tmp/omlivestreambackend';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

/**
 * What the model is allowed to ask ffmpeg to do.
 *
 * Every number here is bounded, and that is the point of the schema rather
 * than a nicety. These values are interpolated directly into ffmpeg filter
 * arguments; an unvalidated response could previously put anything the model
 * emitted — a string, a NaN, a negative duration — into a command line. The
 * bounds are the ranges the eq and fade filters actually accept, so a value
 * that clears validation cannot produce a broken filtergraph either.
 *
 * `.nullable()` throughout because the prompt asks for null to mean "leave
 * this alone", and `.catch(null)` so one unusable field degrades to "no
 * change" instead of failing the whole edit the user is waiting on.
 */
const editPlanSchema = z.object({
  trim: z.object({
    start: z.number().min(0).max(86_400).nullable().catch(null),
    end:   z.number().min(0).max(86_400).nullable().catch(null),
  }).nullable().catch(null).optional(),

  filters: z.object({
    brightness: z.number().min(0).max(2).nullable().catch(null),
    contrast:   z.number().min(0).max(2).nullable().catch(null),
    saturation: z.number().min(0).max(3).nullable().catch(null),
  }).nullable().catch(null).optional(),

  transitions: z.array(z.object({
    type:     z.enum(['fade-in', 'fade-out']),
    duration: z.number().min(0).max(30),
  })).max(4).nullable().catch(null).optional(),

  captions: z.boolean().nullable().catch(null).optional(),
});

type EditPlan = z.infer<typeof editPlanSchema>;

// ── Video Edit Worker ─────────────────────────────────────────────
const editWorker = new Worker('video-edit', async (job) => {
  const { editId, recordingId, userId, prompt, fileUrl } = job.data as {
    editId: string; recordingId: string; userId: string; prompt: string; fileUrl: string;
  };

  logger.info({ editId }, 'Processing video edit job');

  await supabaseAdmin.from('video_edits')
    .update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', editId);

  try {
    // 1. Parse the user's instructions into a bounded plan.
    //
    // A malformed or unreachable response leaves the plan empty rather than
    // failing the job: an unedited copy of the recording is a far better
    // outcome for someone who has already waited through an upload than an
    // error, and the prompt is preserved on the row either way.
    let plan: EditPlan = {};
    try {
      plan = await completeJson({
        userId, feature: 'video-edit', model: 'gpt-4o',
        maxTokens: 500, temperature: 0,
        messages: [
          {
            role: 'system',
            content: `You are an OmliveStream video editing assistant. Parse the user's edit instructions and return ONLY a JSON object with this exact structure (no markdown, no explanation):
{"trim":{"start":null_or_seconds,"end":null_or_seconds},"filters":{"brightness":null_or_0to2,"contrast":null_or_0to2,"saturation":null_or_0to3},"transitions":[{"type":"fade-in","duration":seconds}],"captions":true_or_false}
Null means don't apply. Return ONLY the JSON.`,
          },
          { role: 'user', content: prompt },
        ],
      }, editPlanSchema);
    } catch (err) {
      logger.warn({ editId, err }, 'Edit plan unusable — processing the recording unmodified');
      plan = {};
    }

    // 2. Download source
    const inputPath  = path.join(TMP, `${recordingId}_src.mp4`);
    const outputPath = path.join(TMP, `${editId}_out.mp4`);

    const dl = await axios.get(fileUrl, { responseType: 'stream' });
    await new Promise<void>((res, rej) => {
      const ws = fs.createWriteStream(inputPath);
      dl.data.pipe(ws);
      ws.on('finish', res); ws.on('error', rej);
    });

    // How long the source actually is, so a fade-out can be anchored to its
    // end. Best-effort: if ffprobe cannot read it, fades that need a duration
    // are skipped rather than placed at a guessed offset.
    const sourceDuration = await new Promise<number>((res) => {
      ffmpeg.ffprobe(inputPath, (err, meta) => {
        if (err) {
          logger.warn({ editId, err }, 'ffprobe failed — fade-out will be skipped');
          return res(0);
        }
        res(Number(meta?.format?.duration) || 0);
      });
    });

    // 3. Run ffmpeg
    await new Promise<void>((res, rej) => {
      let cmd = ffmpeg(inputPath);

      const start = plan.trim?.start ?? null;
      const end   = plan.trim?.end   ?? null;
      if (start != null) cmd = cmd.setStartTime(start);
      // Only when the window is actually forward-going. "trim to 30s-10s"
      // produced a negative -t, which ffmpeg reads as no duration limit —
      // so a nonsensical trim silently returned the whole recording.
      if (end != null && end > (start ?? 0)) cmd = cmd.setDuration(end - (start ?? 0));

      const vf: string[] = [];
      // eq=brightness takes -1..1 around a neutral 0, while the prompt asks
      // the model for 0..2 around a neutral 1.
      if (plan.filters?.brightness != null) vf.push(`eq=brightness=${plan.filters.brightness - 1}`);
      if (plan.filters?.contrast   != null) vf.push(`eq=contrast=${plan.filters.contrast}`);
      if (plan.filters?.saturation != null) vf.push(`eq=saturation=${plan.filters.saturation}`);

      const fadeIn  = plan.transitions?.find(t => t.type === 'fade-in');
      const fadeOut = plan.transitions?.find(t => t.type === 'fade-out');
      if (fadeIn) vf.push(`fade=t=in:st=0:d=${fadeIn.duration}`);
      if (fadeOut) {
        // st=99999 meant the fade-out began 27 hours in and never rendered.
        // Anchor it to the end of the output instead, which is the trim
        // window when one was set and the source duration otherwise.
        const outEnd   = end != null && end > (start ?? 0) ? end - (start ?? 0) : sourceDuration;
        const fadeStart = Math.max(0, outEnd - fadeOut.duration);
        if (outEnd > 0) vf.push(`fade=t=out:st=${fadeStart.toFixed(2)}:d=${fadeOut.duration}`);
      }
      if (vf.length) cmd = cmd.videoFilters(vf);

      cmd.output(outputPath)
        .videoCodec('libx264').audioCodec('aac')
        .outputOptions(['-preset fast', '-crf 22', '-movflags +faststart'])
        .on('end', () => res())
        .on('error', (e: Error) => rej(e))
        .run();
    });

    // 4. Upload to Supabase Storage
    const storagePath = `${userId}/${editId}/output.mp4`;
    const buf = fs.readFileSync(outputPath);
    const { error: uploadErr } = await supabaseAdmin.storage.from('recordings')
      .upload(storagePath, buf, { contentType: 'video/mp4', upsert: true });
    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabaseAdmin.storage.from('recordings').getPublicUrl(storagePath);

    // 5. Update DB + notify
    await supabaseAdmin.from('video_edits')
      .update({ status: 'done', output_url: urlData.publicUrl, updated_at: new Date().toISOString() }).eq('id', editId);

    const { data: rec } = await supabaseAdmin.from('recordings').select('stream_id').eq('id', recordingId).single();
    const { data: stream } = rec ? await supabaseAdmin.from('streams').select('title').eq('id', rec.stream_id).single() : { data: null };
    const { data: user } = await supabaseAdmin.from('users').select('email').eq('id', userId).single();
    if (user) await email.sendRecordingReadyEmail(user.email, stream?.title ?? 'AI-Edited Recording');

    // The worker is a separate process with no Socket.io server of its own,
    // so this insert reaches the browser through the Redis adapter — the API
    // instance holding the user's socket is the one that emits. Without the
    // adapter this would still persist and simply arrive on the next poll.
    await notifications.notify({
      userId,
      type:  'ai',
      title: 'AI edit finished',
      body:  `${stream?.title ?? 'Your recording'} has been edited and is ready to download.`,
      link:  '/dashboard/recordings',
    });

    // 6. Cleanup
    [inputPath, outputPath].forEach(p => { try { fs.unlinkSync(p); } catch {} });
    logger.info({ editId }, 'Video edit completed');

  } catch (err) {
    logger.error({ editId, err }, 'Video edit failed');
    await supabaseAdmin.from('video_edits')
      .update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', editId);
    throw err;
  }
}, { connection: createBullConnection(), concurrency: 2 });

// ── Video Publish Worker ──────────────────────────────────────────
const publishWorker = new Worker('video-publish', async (job) => {
  const { recordingId, userId, platform } = job.data as { recordingId: string; userId: string; platform: string };
  logger.info({ recordingId, platform }, 'Processing publish job');
  await supabaseAdmin.from('video_publishes')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('recording_id', recordingId).eq('platform', platform);
  logger.info({ recordingId, platform }, 'Publish job done');
}, { connection: createBullConnection(), concurrency: 5 });

editWorker.on('failed',   (j, e) => logger.error({ jobId: j?.id, err: e.message }, 'Edit job failed'));
publishWorker.on('failed',(j, e) => logger.error({ jobId: j?.id, err: e.message }, 'Publish job failed'));

console.log('BullMQ workers started (video-edit, video-publish)');

// Import broadcast worker (runs in same process)
import '../jobs/broadcast.worker';
