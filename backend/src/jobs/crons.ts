import cron from 'node-cron';
import { supabaseAdmin } from '../config/supabase';
import { EmailService } from '../modules/email/email.service';
import { logger } from '../config/logger';

const email = new EmailService();

/** Daily 08:00 UTC — send birthday emails */
export function scheduleBirthdayCron(): void {
  cron.schedule('0 8 * * *', async () => {
    logger.info('Running birthday cron');
    const now          = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDay   = now.getDate();
    const currentYear  = now.getFullYear();

    const { data: users } = await supabaseAdmin
      .from('users').select('id,email,full_name,dob,birthday_wished_at').not('dob', 'is', null);

    for (const user of users ?? []) {
      try {
        if (!user.dob) continue;
        const dob = new Date(user.dob);
        if (dob.getMonth() + 1 !== currentMonth || dob.getDate() !== currentDay) continue;
        const alreadyWished = user.birthday_wished_at && new Date(user.birthday_wished_at).getFullYear() === currentYear;
        if (alreadyWished) continue;
        await email.sendBirthdayEmail(user.email, user.full_name ?? '');
        await supabaseAdmin.from('users').update({ birthday_wished_at: now.toISOString() }).eq('id', user.id);
        logger.info({ userId: user.id }, 'Birthday email sent');
      } catch (err) {
        logger.error({ userId: user.id, err }, 'Birthday cron error for user');
      }
    }
  });
  logger.info('Birthday cron scheduled (daily 08:00 UTC)');
}

/** Daily 10:00 UTC — re-engage users silent for 5+ days */
export function scheduleReEngagementCron(): void {
  cron.schedule('0 10 * * *', async () => {
    logger.info('Running re-engagement cron');
    const fiveDaysAgo  = new Date(Date.now() - 5  * 86_400_000).toISOString();
    const twoWeeksAgo  = new Date(Date.now() - 14 * 86_400_000).toISOString();

    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id,email,full_name,last_stream_ended_at,re_engagement_sent_at')
      .not('last_stream_ended_at', 'is', null)
      .lt('last_stream_ended_at', fiveDaysAgo);

    for (const user of users ?? []) {
      try {
        if (user.re_engagement_sent_at && new Date(user.re_engagement_sent_at) > new Date(twoWeeksAgo)) continue;
        await email.sendReEngagementEmail(user.email, user.full_name ?? '');
        await supabaseAdmin.from('users').update({ re_engagement_sent_at: new Date().toISOString() }).eq('id', user.id);
        logger.info({ userId: user.id }, 'Re-engagement email sent');
      } catch (err) {
        logger.error({ userId: user.id, err }, 'Re-engagement cron error for user');
      }
    }
  });
  logger.info('Re-engagement cron scheduled (daily 10:00 UTC)');
}

export function startCronJobs(): void {
  scheduleTrialManagementCron();
  scheduleBirthdayCron();
  scheduleReEngagementCron();
}

/**
 * Trial management cron — runs daily at 09:00 UTC.
 * 1. Sends "trial ending soon" email 7 days before expiry
 * 2. Downgrades expired trials from free_trial → free
 * 3. Sends "trial expired" email on expiry day
 */
export function scheduleTrialManagementCron(): void {
  cron.schedule('0 9 * * *', async () => {
    logger.info('Running trial management cron');
    const now        = new Date();
    const in7Days    = new Date(now.getTime() + 7 * 86_400_000);

    // 1. Warn users whose trial ends in exactly 7 days
    const { data: endingSoon } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name, trial_expires_at')
      .eq('plan', 'free_trial')
      .gte('trial_expires_at', now.toISOString())
      .lte('trial_expires_at', in7Days.toISOString());

    for (const user of endingSoon ?? []) {
      try {
        const daysLeft = Math.ceil((new Date(user.trial_expires_at!).getTime() - now.getTime()) / 86_400_000);
        await email.sendTrialEndingSoonEmail(user.email, user.full_name ?? '', daysLeft);
        logger.info({ userId: user.id, daysLeft }, 'Trial ending soon email sent');
      } catch (err) {
        logger.error({ userId: user.id, err }, 'Trial ending email failed');
      }
    }

    // 2. Downgrade expired trials
    const { data: expired } = await supabaseAdmin
      .from('users')
      .select('id, email, full_name')
      .eq('plan', 'free_trial')
      .lt('trial_expires_at', now.toISOString());

    for (const user of expired ?? []) {
      try {
        await supabaseAdmin.from('users').update({
          plan:       'free',
          updated_at: now.toISOString(),
        }).eq('id', user.id);

        await email.sendTrialExpiredEmail(user.email, user.full_name ?? '');
        logger.info({ userId: user.id }, 'Trial expired — downgraded to free, email sent');
      } catch (err) {
        logger.error({ userId: user.id, err }, 'Trial expiry processing failed');
      }
    }
  });
  logger.info('Trial management cron scheduled (daily 09:00 UTC)');
}
