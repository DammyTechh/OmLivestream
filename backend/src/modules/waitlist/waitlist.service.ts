import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import { supabaseAdmin } from '../../config/supabase';
import { ConflictError, AppError } from '../../utils/errors';
import { EmailService } from '../email/email.service';

const emailSvc = new EmailService();

function generateDiscountCode(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

export class WaitlistService {

  /**
   * Join the waitlist.
   * Sends confirmation email with the special offer.
   * Does NOT require authentication — this is a public landing page action.
   */
  async join(payload: {
    email:    string;
    source?:  string;
    ip?:      string;
    metadata?: Record<string, string>;
  }): Promise<{ message: string; alreadyOnList: boolean }> {
    const email = payload.email.toLowerCase().trim();

    // Check if already on list
    const { data: existing } = await supabaseAdmin
      .from('waitlist').select('id').eq('email', email).maybeSingle();

    if (existing) {
      return { message: "You're already on the waitlist — we'll be in touch soon!", alreadyOnList: true };
    }

    // Insert to waitlist
    const { error } = await supabaseAdmin.from('waitlist').insert({
      id:        uuidv4(),
      email,
      source:    payload.source ?? 'landing-page',
      ip_address: payload.ip ?? null,
      metadata:  payload.metadata ?? null,
    });

    if (error) throw error;

    // Send waitlist confirmation email with full offer details
    await emailSvc.sendWaitlistConfirmationEmail(email);

    return { message: "You're on the list. Check your email for your exclusive offer.", alreadyOnList: false };
  }

  /**
   * When a waitlist member registers, grant them their rewards:
   *  - 1 month free trial extension (total: 90 + 30 = 120 days trial)
   *  - Discount code for 50% off first 6 months
   *
   * Called from auth.service after account creation if email matches waitlist.
   */
  async grantWaitlistReward(email: string, userId: string): Promise<void> {
    const { data: waitlistEntry } = await supabaseAdmin
      .from('waitlist')
      .select('*')
      .eq('email', email.toLowerCase())
      .maybeSingle();

    if (!waitlistEntry || waitlistEntry.reward_granted) return;

    // Generate two discount codes
    const freeMonthCode    = generateDiscountCode('OMLS1FREE');
    const sixMonthCode     = generateDiscountCode('OMLS6DISC');
    const freeMonthExpiry  = new Date(Date.now() + 90 * 86_400_000).toISOString(); // 90 days to use
    const sixMonthExpiry   = new Date(Date.now() + 90 * 86_400_000).toISOString();

    await supabaseAdmin.from('discount_codes').insert([
      {
        id: uuidv4(), code: freeMonthCode, user_id: userId,
        waitlist_id: waitlistEntry.id, discount_type: 'first_month_free',
        free_months: 1, discount_pct: null, is_used: false, expires_at: freeMonthExpiry,
      },
      {
        id: uuidv4(), code: sixMonthCode, user_id: userId,
        waitlist_id: waitlistEntry.id, discount_type: 'six_month_50pct',
        free_months: null, discount_pct: 50, is_used: false, expires_at: sixMonthExpiry,
      },
    ]);

    // Extend trial by 30 extra days for waitlist members (total 120 days)
    await supabaseAdmin.from('users').update({
      waitlist_member:         true,
      waitlist_reward_claimed: true,
      trial_expires_at:        new Date(Date.now() + 120 * 86_400_000).toISOString(),
      updated_at:              new Date().toISOString(),
    }).eq('id', userId);

    // Link waitlist entry to user
    await supabaseAdmin.from('waitlist').update({
      converted_user_id: userId,
      reward_granted:    true,
      reward_granted_at: new Date().toISOString(),
    }).eq('id', waitlistEntry.id);

    // Send reward email with the discount codes
    await emailSvc.sendWaitlistRewardEmail(email, {
      freeMonthCode,
      sixMonthCode,
      trialDays: 120,
    });
  }

  /**
   * Admin: list all waitlist entries with conversion stats.
   */
  async listWaitlist(opts: { page: number; limit: number; converted?: boolean }) {
    let query = supabaseAdmin
      .from('waitlist')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((opts.page - 1) * opts.limit, opts.page * opts.limit - 1);

    if (opts.converted !== undefined) {
      opts.converted
        ? query = query.not('converted_user_id', 'is', null)
        : query = query.is('converted_user_id', null);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { data: data ?? [], total: count ?? 0 };
  }

  /**
   * Admin: get waitlist stats.
   */
  async getWaitlistStats() {
    const [
      { count: total },
      { count: converted },
      { count: rewardGranted },
    ] = await Promise.all([
      supabaseAdmin.from('waitlist').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('waitlist').select('*', { count: 'exact', head: true }).not('converted_user_id', 'is', null),
      supabaseAdmin.from('waitlist').select('*', { count: 'exact', head: true }).eq('reward_granted', true),
    ]);

    return {
      total:        total ?? 0,
      converted:    converted ?? 0,
      pending:      (total ?? 0) - (converted ?? 0),
      rewardGranted: rewardGranted ?? 0,
      conversionRate: total ? `${Math.round(((converted ?? 0) / total) * 100)}%` : '0%',
    };
  }
}
