import 'dotenv/config';
import { Worker } from 'bullmq';
import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import { createBullConnection } from '../config/redis';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { EmailService } from '../modules/email/email.service';
import { logger } from '../config/logger';

const ai    = new OpenAI({ apiKey: env.OPENAI_API_KEY });
const email  = new EmailService();
const TMP = '/tmp/omlivestreambackend';
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

interface EditPlan {
  trim?:        { start?: number; end?: number };
  filters?:     { brightness?: number; contrast?: number; saturation?: number };
  transitions?: { type: 'fade-in' | 'fade-out'; duration: number }[];
  captions?:    boolean;
}

// ── Video Edit Worker ─────────────────────────────────────────────
const editWorker = new Worker('video-edit', async (job) => {
  const { editId, recordingId, userId, prompt, fileUrl } = job.data as {
    editId: string; recordingId: string; userId: string; prompt: string; fileUrl: string;
  };

  logger.info({ editId }, 'Processing video edit job');

  await supabaseAdmin.from('video_edits')
    .update({ status: 'processing', updated_at: new Date().toISOString() }).eq('id', editId);

  try {
    // 1. Parse prompt with GPT-4o
    const gpt = await ai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `You are an OmliveStream video editing assistant. Parse the user's edit instructions and return ONLY a JSON object with this exact structure (no markdown, no explanation):
{"trim":{"start":null_or_seconds,"end":null_or_seconds},"filters":{"brightness":null_or_0to2,"contrast":null_or_0to2,"saturation":null_or_0to3},"transitions":[{"type":"fade-in","duration":seconds}],"captions":true_or_false}
Null means don't apply. Return ONLY the JSON.`,
        },
        { role: 'user', content: prompt },
      ],
    });

    let plan: EditPlan = {};
    try { plan = JSON.parse((gpt.choices[0]?.message?.content ?? '{}').replace(/```json|```/g, '').trim()); } catch { plan = {}; }

    // 2. Download source
    const inputPath  = path.join(TMP, `${recordingId}_src.mp4`);
    const outputPath = path.join(TMP, `${editId}_out.mp4`);

    const dl = await axios.get(fileUrl, { responseType: 'stream' });
    await new Promise<void>((res, rej) => {
      const ws = fs.createWriteStream(inputPath);
      dl.data.pipe(ws);
      ws.on('finish', res); ws.on('error', rej);
    });

    // 3. Run ffmpeg
    await new Promise<void>((res, rej) => {
      let cmd = ffmpeg(inputPath);
      if (plan.trim?.start != null) cmd = cmd.setStartTime(plan.trim.start);
      if (plan.trim?.end   != null) cmd = cmd.setDuration((plan.trim.end) - (plan.trim.start ?? 0));

      const vf: string[] = [];
      if (plan.filters?.brightness != null) vf.push(`eq=brightness=${plan.filters.brightness - 1}`);
      if (plan.filters?.contrast   != null) vf.push(`eq=contrast=${plan.filters.contrast}`);
      if (plan.filters?.saturation != null) vf.push(`eq=saturation=${plan.filters.saturation}`);
      const fadeIn  = plan.transitions?.find(t => t.type === 'fade-in');
      const fadeOut = plan.transitions?.find(t => t.type === 'fade-out');
      if (fadeIn)  vf.push(`fade=t=in:d=${fadeIn.duration}`);
      if (fadeOut) vf.push(`fade=t=out:st=99999:d=${fadeOut.duration}`);
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
