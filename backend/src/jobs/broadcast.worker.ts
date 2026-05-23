/**
 * OmliveStream Broadcast Email Worker
 * ─────────────────────────────────────────────────────────────────
 * Processes admin broadcast campaigns from the BullMQ queue.
 *
 * Strategy:
 *  - Fetches all pending recipients from broadcast_logs
 *  - Sends in batches of 50 with 200ms delay between batches
 *  - This respects Resend's rate limit (~100 req/s on paid plan)
 *  - Each email sent individually so failed ones don't affect others
 *  - Updates sent_count / failed_count in real-time on the broadcast row
 *  - Marks broadcast as 'sent' when all recipients processed
 */

import 'dotenv/config';
import { Worker } from 'bullmq';
import { Resend } from 'resend';
import { createBullConnection } from '../config/redis';
import { env } from '../config/env';
import { supabaseAdmin } from '../config/supabase';
import { logger } from '../config/logger';

const resend = new Resend(env.RESEND_API_KEY);

const BATCH_SIZE  = 50;
const BATCH_DELAY = 200; // ms between batches — stay within Resend rate limit

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const broadcastWorker = new Worker('broadcast-email', async (job) => {
  const { broadcastId } = job.data as { broadcastId: string };

  logger.info({ broadcastId, jobName: job.name }, 'Processing broadcast job');

  // Handle scheduled broadcasts (triggered by delayed BullMQ job)
  if (job.name === 'scheduled-broadcast') {
    // Re-trigger as a send job
    const { AdminBroadcastService } = await import('../modules/admin/admin.broadcast.service');
    const svc = new AdminBroadcastService();

    const broadcast = await supabaseAdmin
      .from('admin_broadcasts')
      .select('id, status, admin_id')
      .eq('id', broadcastId)
      .single();

    if (!broadcast.data || broadcast.data.status !== 'scheduled') {
      logger.warn({ broadcastId }, 'Scheduled broadcast not in scheduled state — skipping');
      return;
    }

    await svc.send(broadcast.data.admin_id, broadcastId);
    return;
  }

  // Handle 'send-broadcast' job — actual email delivery
  if (job.name !== 'send-broadcast') return;

  // Fetch the broadcast content
  const { data: broadcast, error: bErr } = await supabaseAdmin
    .from('admin_broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (bErr || !broadcast) {
    logger.error({ broadcastId }, 'Broadcast not found — aborting');
    return;
  }

  // Get all pending recipients
  const { data: pendingLogs } = await supabaseAdmin
    .from('broadcast_logs')
    .select('id, user_id, email')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  const recipients = pendingLogs ?? [];
  logger.info({ broadcastId, recipientCount: recipients.length }, 'Starting email delivery');

  let sentCount   = 0;
  let failedCount = 0;

  // Send in batches of BATCH_SIZE
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    await Promise.allSettled(batch.map(async (recipient) => {
      try {
        // Send via Resend
        await resend.emails.send({
          from:    env.EMAIL_FROM,
          to:      recipient.email,
          subject: broadcast.subject,
          html:    broadcast.body_html,
          text:    broadcast.body_text ?? undefined,
          headers: {
            'X-Broadcast-ID': broadcastId,
            'X-User-ID':      recipient.user_id,
          },
        });

        // Mark delivered
        await supabaseAdmin.from('broadcast_logs').update({
          status:  'sent',
          sent_at: new Date().toISOString(),
        }).eq('id', recipient.id);

        sentCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ broadcastId, email: recipient.email, err: errMsg }, 'Email delivery failed');

        // Mark failed with error
        await supabaseAdmin.from('broadcast_logs').update({
          status: 'failed',
          error:  errMsg.slice(0, 500),
        }).eq('id', recipient.id);

        failedCount++;
      }
    }));

    // Update live stats on broadcast row after each batch
    await supabaseAdmin.from('admin_broadcasts').update({
      sent_count:   sentCount,
      failed_count: failedCount,
      updated_at:   new Date().toISOString(),
    }).eq('id', broadcastId);

    // Rate-limit delay between batches (skip on last batch)
    if (i + BATCH_SIZE < recipients.length) {
      await delay(BATCH_DELAY);
    }

    logger.debug({
      broadcastId,
      progress:    `${Math.min(i + BATCH_SIZE, recipients.length)}/${recipients.length}`,
      sentCount,
      failedCount,
    }, 'Batch complete');
  }

  // Mark broadcast as sent
  await supabaseAdmin.from('admin_broadcasts').update({
    status:       'sent',
    sent_count:   sentCount,
    failed_count: failedCount,
    sent_at:      new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }).eq('id', broadcastId);

  logger.info({
    broadcastId,
    total:   recipients.length,
    sent:    sentCount,
    failed:  failedCount,
    subject: broadcast.subject,
  }, '✅ Broadcast complete');

}, {
  connection:  createBullConnection(),
  concurrency: 2, // process 2 broadcasts simultaneously max
});

broadcastWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, broadcastId: job?.data?.broadcastId, err: err.message }, 'Broadcast job failed');

  // Mark broadcast as failed if job exhausted all retries
  if (job?.data?.broadcastId) {
    supabaseAdmin.from('admin_broadcasts').update({
      status:     'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', job.data.broadcastId).then(() => {});
  }
});

broadcastWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'Broadcast job completed');
});

logger.info('📬 Broadcast email worker started');
export { broadcastWorker };
