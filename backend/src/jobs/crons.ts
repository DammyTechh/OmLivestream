import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { redis, REDIS_KEYS } from '../config/redis';
import { EmailService } from '../modules/email/email.service';
import { logger } from '../config/logger';

const email = new EmailService();

/**
 * Claim today's run of a job for this instance.
 *
 * Every instance runs the same schedule, so without a shared lock a
 * three-instance deployment sends every user three birthday emails. The key
 * carries the date, so it expires naturally and a run that crashes mid-way
 * does not block tomorrow's.
 *
 * Returns false when Redis cannot answer. That is the deliberate choice: an
 * unavailable lock means we cannot know whether a sibling is already sending,
 * and skipping a day of re-engagement email is a far smaller harm than
 * mailing every user N times. These jobs are idempotent-by-date anyway — the
 * next day's run picks up anyone missed.
 */
async function claimRun(job: string): Promise<boolean> {
  const day  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const held = await redis.setnx(REDIS_KEYS.CRON_LOCK(job, day), '1', 23 * 3600);

  if (held === null) {
    logger.warn({ job }, 'Cron lock unavailable (Redis down) — skipping run to avoid duplicate sends');
    return false;
  }
  if (!held) {
    logger.debug({ job }, 'Cron run already claimed by another instance');
    return false;
  }
  return true;
}

/**
 * How many emails are in flight at once.
 *
 * Not a performance dial so much as a politeness one: Resend rate-limits per
 * account, and firing 5,000 requests in parallel earns 429s for most of them.
 * Sending strictly one at a time was the other extreme — a 5,000-user
 * birthday run at ~200ms per send would take about 17 minutes, during which
 * an unhandled failure loses the remainder.
 */
const EMAIL_CONCURRENCY = 5;

/** Ceiling per run, so one cron invocation cannot pin unbounded memory. */
const MAX_PER_RUN = 5_000;

/**
 * Run `worker` over `items` with a fixed number of workers.
 *
 * Returns the ids that succeeded, so the caller can record them in one
 * statement rather than issuing an update per item.
 */
async function mapLimit<T extends { id: string }>(
  items: T[],
  worker: (item: T) => Promise<void>,
): Promise<string[]> {
  const succeeded: string[] = [];
  let cursor = 0;

  const runner = async (): Promise<void> => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try {
        await worker(item);
        succeeded.push(item.id);
      } catch (err) {
        // One bad address must not abort the run for everyone behind it.
        logger.error({ userId: item.id, err }, 'Cron item failed');
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(EMAIL_CONCURRENCY, items.length) }, runner),
  );
  return succeeded;
}

/** Daily 08:00 UTC — send birthday emails */
export function scheduleBirthdayCron(): void {
  cron.schedule('0 8 * * *', async () => {
    if (!await claimRun('birthday')) return;
    logger.info('Running birthday cron');
    const now         = new Date();
    const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();

    // Filtered entirely in Postgres via the generated birth_month/birth_day
    // columns. This previously pulled every user with a date of birth into
    // Node and discarded ~364/365 of them, so its cost grew with total
    // signups rather than with the number of birthdays today.
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id,email,full_name')
      .eq('birth_month', now.getUTCMonth() + 1)
      .eq('birth_day', now.getUTCDate())
      // "Not already wished this calendar year" — also a server-side filter.
      .or(`birthday_wished_at.is.null,birthday_wished_at.lt.${startOfYear}`)
      .limit(MAX_PER_RUN);

    if (error) {
      logger.error({ err: error }, 'Birthday cron query failed');
      return;
    }
    if (!users?.length) return;

    const sent = await mapLimit(users, (u) =>
      email.sendBirthdayEmail(u.email, u.full_name ?? ''));

    // One update for everyone who received it, not one per user.
    if (sent.length) {
      await supabaseAdmin.from('users')
        .update({ birthday_wished_at: now.toISOString() })
        .in('id', sent);
    }
    logger.info({ sent: sent.length, matched: users.length }, 'Birthday cron finished');
  });
  logger.info('Birthday cron scheduled (daily 08:00 UTC)');
}

/** Daily 10:00 UTC — re-engage users silent for 5+ days */
export function scheduleReEngagementCron(): void {
  cron.schedule('0 10 * * *', async () => {
    if (!await claimRun('re-engagement')) return;
    logger.info('Running re-engagement cron');
    const now         = new Date();
    const fiveDaysAgo = new Date(now.getTime() - 5  * 86_400_000).toISOString();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();

    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id,email,full_name')
      .not('last_stream_ended_at', 'is', null)
      .lt('last_stream_ended_at', fiveDaysAgo)
      // Was a JS `continue` after loading the row; now it never leaves Postgres.
      .or(`re_engagement_sent_at.is.null,re_engagement_sent_at.lte.${twoWeeksAgo}`)
      .limit(MAX_PER_RUN);

    if (error) {
      logger.error({ err: error }, 'Re-engagement cron query failed');
      return;
    }
    if (!users?.length) return;

    const sent = await mapLimit(users, (u) =>
      email.sendReEngagementEmail(u.email, u.full_name ?? ''));

    if (sent.length) {
      await supabaseAdmin.from('users')
        .update({ re_engagement_sent_at: now.toISOString() })
        .in('id', sent);
    }
    logger.info({ sent: sent.length, matched: users.length }, 'Re-engagement cron finished');
  });
  logger.info('Re-engagement cron scheduled (daily 10:00 UTC)');
}

/**
 * Trial management cron — runs daily at 09:00 UTC.
 * 1. Sends "trial ending soon" email 7 days before expiry
 * 2. Downgrades expired trials from free_trial → free
 * 3. Sends "trial expired" email on expiry day
 */
export function scheduleTrialManagementCron(): void {
  cron.schedule('0 9 * * *', async () => {
    if (!await claimRun('trial-management')) return;
    logger.info('Running trial management cron');
    const now     = new Date();
    const in7Days = new Date(now.getTime() + 7 * 86_400_000);

    // 1. Warn users whose trial ends within 7 days
    const { data: endingSoon } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, trial_expires_at')
      .eq('plan', 'free_trial')
      .gte('trial_expires_at', now.toISOString())
      .lte('trial_expires_at', in7Days.toISOString())
      .limit(MAX_PER_RUN);

    if (endingSoon?.length) {
      const sent = await mapLimit(endingSoon, (u) => {
        const daysLeft = Math.ceil(
          (new Date(u.trial_expires_at!).getTime() - now.getTime()) / 86_400_000);
        return email.sendTrialEndingSoonEmail(u.email, u.full_name ?? '', daysLeft);
      });
      logger.info({ sent: sent.length }, 'Trial ending soon emails sent');
    }

    // 2. Downgrade expired trials
    const { data: expired } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name')
      .eq('plan', 'free_trial')
      .lt('trial_expires_at', now.toISOString())
      .limit(MAX_PER_RUN);

    if (!expired?.length) return;

    // Downgrade first, in one statement. Losing access is the part that must
    // not depend on an email provider being reachable — under the old code a
    // send failure skipped the downgrade, silently extending the trial.
    const { error: downgradeErr } = await supabaseAdmin.from('users')
      .update({ plan: 'free', updated_at: now.toISOString() })
      .in('id', expired.map(u => u.id));

    if (downgradeErr) {
      logger.error({ err: downgradeErr }, 'Trial downgrade failed — not sending expiry emails');
      return;
    }

    const notified = await mapLimit(expired, (u) =>
      email.sendTrialExpiredEmail(u.email, u.full_name ?? ''));

    logger.info(
      { downgraded: expired.length, notified: notified.length },
      'Trial management cron finished',
    );
  });
  logger.info('Trial management cron scheduled (daily 09:00 UTC)');
}

/**
 * Notification and AI-history retention — runs daily at 03:00 UTC.
 *
 * The table only ever grows: every go-live, every recording, every renewal
 * writes a row, and the bell shows the newest thirty. Without this, a heavy
 * account accumulates thousands of rows nobody will ever scroll to, and the
 * unread count query gets slower every month for no benefit.
 *
 * Two windows rather than one, because the rows mean different things. A row
 * the user has seen has done its whole job, so it goes after 30 days. An
 * unread row might still be the only record that a stream failed to reach a
 * platform, so it is kept for 90 — long enough to be useful, short enough
 * that the table stays bounded.
 */
export function scheduleNotificationRetentionCron(): void {
  cron.schedule('0 3 * * *', async () => {
    if (!await claimRun('notification-retention')) return;

    const now       = Date.now();
    const readCut   = new Date(now - 30 * 86_400_000).toISOString();
    const anyCut    = new Date(now - 90 * 86_400_000).toISOString();

    // Deleted by age, not by id list: this is a bulk statement Postgres can
    // satisfy from idx_notifications_user_created, and pulling the ids into
    // Node first would move tens of thousands of uuids over the wire to
    // achieve exactly the same delete.
    const [readRes, oldRes] = await Promise.all([
      supabaseAdmin.from('notifications').delete()
        .not('read_at', 'is', null).lt('read_at', readCut).select('id'),
      supabaseAdmin.from('notifications').delete()
        .lt('created_at', anyCut).select('id'),
    ]);

    if (readRes.error || oldRes.error) {
      logger.error({ readErr: readRes.error, oldErr: oldRes.error }, 'Notification retention sweep failed');
      return;
    }

    // AI transcripts age out on the same sweep. Only the last 10 turns are
    // ever replayed to the model, so a month-old message is storage with no
    // reader — and it is chat content, which is the last thing to keep
    // indefinitely without a reason.
    const chatCut = new Date(now - 30 * 86_400_000).toISOString();
    const { data: chatDeleted, error: chatErr } = await supabaseAdmin
      .from('ai_messages').delete().lt('created_at', chatCut).select('id');
    if (chatErr) logger.warn({ err: chatErr }, 'AI history sweep failed');

    logger.info(
      {
        readDeleted:  readRes.data?.length ?? 0,
        agedDeleted:  oldRes.data?.length ?? 0,
        chatDeleted:  chatDeleted?.length ?? 0,
      },
      'Notification retention cron finished',
    );
  });
  logger.info('Notification retention cron scheduled (daily 03:00 UTC)');
}

export function startCronJobs(): void {
  scheduleTrialManagementCron();
  scheduleBirthdayCron();
  scheduleReEngagementCron();
  scheduleNotificationRetentionCron();
}
