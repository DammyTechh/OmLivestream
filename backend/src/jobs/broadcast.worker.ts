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

/**
 * Safety stop for the drain loop below.
 *
 * The loop repeatedly asks for "the next page of pending recipients" and
 * relies on each pass marking those rows sent or failed. If an update ever
 * silently no-ops, the same page would come back forever and the worker
 * would spin sending duplicate email. This bounds it at a campaign of
 * 500k recipients, far above any real segment.
 */
const MAX_BATCHES = 10_000;

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

  // Fetch the broadcast content. Named columns rather than '*': body_html on
  // a long campaign is the largest single value in this table, and the rest
  // of the row is never read here.
  const { data: broadcast, error: bErr } = await supabaseAdmin
    .from('admin_broadcasts')
    .select('subject, body_html, body_text')
    .eq('id', broadcastId)
    .single();

  if (bErr || !broadcast) {
    logger.error({ broadcastId }, 'Broadcast not found — aborting');
    return;
  }

  // How many recipients are waiting, for progress logging only. head: true
  // so this does not pull the rows themselves.
  const { count: pendingTotal } = await supabaseAdmin
    .from('broadcast_logs')
    .select('id', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  const total = pendingTotal ?? 0;
  logger.info({ broadcastId, recipientCount: total }, 'Starting email delivery');

  let sentCount   = 0;
  let failedCount = 0;
  let batches     = 0;

  // Drain one page at a time rather than loading every recipient up front.
  // A 5,000-person campaign previously sat as 5,000 rows in the worker's heap
  // for the whole run; this holds BATCH_SIZE of them. Each pass takes the
  // rows that are still pending, so the query itself is the cursor — no
  // offset to skew as rows change status underneath it.
  for (;;) {
    if (++batches > MAX_BATCHES) {
      logger.error({ broadcastId, sentCount, failedCount },
        'Broadcast exceeded MAX_BATCHES — stopping. Pending rows were not transitioning; check broadcast_logs.');
      break;
    }

    const { data: page, error: pageErr } = await supabaseAdmin
      .from('broadcast_logs')
      .select('id, user_id, email')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending')
      .order('id', { ascending: true })
      .limit(BATCH_SIZE);

    if (pageErr) {
      logger.error({ broadcastId, err: pageErr }, 'Could not read next recipient page — aborting run');
      break;
    }
    if (!page?.length) break;

    const sentIds: string[] = [];
    // Grouped by message so identical failures collapse into one statement;
    // the error text is stored per row, so it has to be part of the key.
    const failedByError = new Map<string, string[]>();

    await Promise.allSettled(page.map(async (recipient) => {
      try {
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
        sentIds.push(recipient.id);
      } catch (err) {
        const errMsg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
        logger.warn({ broadcastId, email: recipient.email, err: errMsg }, 'Email delivery failed');
        const ids = failedByError.get(errMsg);
        if (ids) ids.push(recipient.id);
        else failedByError.set(errMsg, [recipient.id]);
      }
    }));

    const now = new Date().toISOString();

    // One UPDATE for every success in the batch, and one per distinct error,
    // instead of one per recipient. At 50 per batch that is up to 50 round
    // trips collapsed into typically one.
    //
    // These must complete before the next iteration queries for pending rows,
    // otherwise the same recipients would be selected and emailed again.
    // Promise.resolve() around each builder: PostgREST's query builder is
    // thenable but not a Promise, so it has no .catch and cannot go straight
    // into Promise.all's typed signature.
    const writes: Promise<unknown>[] = [];
    if (sentIds.length) {
      writes.push(Promise.resolve(supabaseAdmin.from('broadcast_logs')
        .update({ status: 'sent', sent_at: now })
        .in('id', sentIds)));
    }
    for (const [errMsg, ids] of failedByError) {
      writes.push(Promise.resolve(supabaseAdmin.from('broadcast_logs')
        .update({ status: 'failed', error: errMsg })
        .in('id', ids)));
    }

    const results = await Promise.all(writes.map(w => w.then(
      (r: any) => r?.error ?? null,
      (e: unknown) => e,
    )));
    const writeErr = results.find(r => r !== null && r !== undefined);
    if (writeErr) {
      // Bail rather than loop: if the status never changes, the next query
      // returns the same page and those people get a second email.
      logger.error({ broadcastId, err: writeErr },
        'Could not record delivery status — stopping to avoid re-sending this batch');
      break;
    }

    sentCount   += sentIds.length;
    failedCount += page.length - sentIds.length;

    await supabaseAdmin.from('admin_broadcasts').update({
      sent_count:   sentCount,
      failed_count: failedCount,
      updated_at:   now,
    }).eq('id', broadcastId);

    logger.debug({
      broadcastId,
      progress: `${sentCount + failedCount}/${total}`,
      sentCount,
      failedCount,
    }, 'Batch complete');

    if (page.length === BATCH_SIZE) await delay(BATCH_DELAY);
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
    total,
    sent:    sentCount,
    failed:  failedCount,
    subject: broadcast.subject,
  }, 'Broadcast complete');

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

logger.info('Broadcast email worker started');
export { broadcastWorker };
