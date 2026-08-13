import { supabaseAdmin } from '../../config/supabase';
import { NotFoundError, ValidationError } from '../../utils/errors';

/**
 * Columns returned by GET /users/me.
 *
 * Named explicitly rather than '*'. This is the most frequently called
 * authenticated route in the app — the frontend loads it on every page —
 * and '*' shipped the cron bookkeeping columns (birthday_wished_at,
 * re_engagement_sent_at) and the generated birth_month/birth_day on every
 * single request.
 *
 * It also means a column added by a later migration is invisible to clients
 * until it is named here, which is the safer default for a table holding
 * billing and moderation state.
 *
 * The embedded onboarding_responses row rides along on the same request —
 * PostgREST resolves it through the foreign key, so this stays one round
 * trip. See getProfile for why it is needed.
 */
const PROFILE_COLUMNS =
  'id,email,full_name,dob,location,avatar_url,plan,is_verified,status,' +
  'waitlist_member,waitlist_reward_claimed,trial_expires_at,' +
  'last_stream_ended_at,created_at,updated_at,tour_views,' +
  'onboarding_responses(completed_at)';

export class UsersService {

  /**
   * The current user, plus a computed `onboarding_completed` flag.
   *
   * That flag is computed rather than stored because there is no such
   * column — and the frontend's AuthGuard was already testing
   * `user.onboarding_completed === false` to decide whether to redirect to
   * /onboarding. Reading a column that does not exist yields undefined, and
   * `undefined === false` is false, so that redirect never fired and users
   * who skipped onboarding were silently let through to the dashboard.
   *
   * The definition matches getOnboardingStatus below — a name on the
   * profile and a completed survey — so the two cannot disagree.
   */
  async getProfile(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('users').select(PROFILE_COLUMNS).eq('id', userId).single();
    if (error || !data) throw new NotFoundError('User');

    // Cast through unknown: with an embedded relation in the select string,
    // supabase-js widens the row type to a union that includes its parse-error
    // marker, which does not overlap a plain record.
    const row = data as unknown as Record<string, unknown>;

    // An embedded to-one relation normally arrives as an object, but PostgREST
    // sends an array when it cannot prove the relation is unique. Handle both
    // rather than depending on which inference it makes.
    const raw    = row.onboarding_responses;
    const survey = (Array.isArray(raw) ? raw[0] : raw) as { completed_at?: string } | null;

    const { onboarding_responses: _omit, ...user } = row;

    return {
      ...user,
      onboarding_completed: !!(user.full_name && survey?.completed_at),
    };
  }

  /**
   * Check onboarding completion — returns survey answers if completed
   */
  async getOnboardingStatus(userId: string) {
    const { data: user } = await supabaseAdmin
      .from('users').select('full_name,dob,location,avatar_url').eq('id', userId).single();

    const { data: survey } = await supabaseAdmin
      .from('onboarding_responses').select('heard_from,use_case,completed_at').eq('user_id', userId).maybeSingle();

    const profileComplete = !!(user?.full_name);
    const surveyComplete  = !!(survey?.completed_at);

    return {
      complete: profileComplete && surveyComplete,
      profileComplete,
      surveyComplete,
      profile: user ?? null,
      survey:  survey ?? null,
    };
  }

  async updateProfile(userId: string, updates: {
    full_name?: string; dob?: string; location?: string; avatar_url?: string;
  }) {
    if (updates.dob) {
      const d = new Date(updates.dob);
      if (isNaN(d.getTime())) throw new ValidationError('Invalid date of birth — use YYYY-MM-DD');
      const ageDays = (Date.now() - d.getTime()) / 86_400_000;
      if (ageDays < 13 * 365)  throw new ValidationError('You must be at least 13 years old to use OmliveStream');
      if (ageDays > 120 * 365) throw new ValidationError('Invalid date of birth');
    }
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId).select('*').single();
    if (error || !data) throw new NotFoundError('User');
    return data;
  }

  /**
   * Onboarding Step 1 — Personal details
   * Collected immediately after first sign-in.
   * full_name, dob (for birthday emails + age verification), location
   */
  async saveOnboardingProfile(userId: string, payload: {
    full_name: string;
    dob: string;
    location: string;
  }) {
    // Age validation
    const dob = new Date(payload.dob);
    if (isNaN(dob.getTime())) throw new ValidationError('Invalid date of birth — use YYYY-MM-DD');
    const ageDays = (Date.now() - dob.getTime()) / 86_400_000;
    if (ageDays < 13 * 365) throw new ValidationError('You must be at least 13 years old to use OmliveStream');

    await supabaseAdmin.from('users').update({
      full_name:  payload.full_name,
      dob:        payload.dob,
      location:   payload.location,
      updated_at: new Date().toISOString(),
    }).eq('id', userId);
  }

  /**
   * Onboarding Step 2 — Survey
   * How did you hear about us? What will you use OmliveStream for?
   */
  async saveOnboardingSurvey(userId: string, payload: {
    heard_from: string[];
    use_case:   string[];
  }) {
    const { error } = await supabaseAdmin.from('onboarding_responses').upsert({
      user_id:      userId,
      heard_from:   payload.heard_from,
      use_case:     payload.use_case,
      completed_at: new Date().toISOString(),
    });
    if (error) throw error;
  }

  // Legacy single-call onboarding (kept for compatibility)
  async saveOnboarding(userId: string, payload: { heard_from: string[]; use_case: string[] }) {
    return this.saveOnboardingSurvey(userId, payload);
  }

  /**
   * The first-run dashboard walkthrough is shown for a user's first few login
   * sessions and then retires itself. `tour_views` counts how many sessions it
   * has played in; the frontend calls this once per session while the tour is
   * still active. The cap lives here so the ceiling is enforced server-side
   * regardless of what the client sends.
   *
   * Read-then-write rather than an atomic `least(tour_views+1, 3)`: it is a
   * single-user, once-per-session call with no contention, and this keeps the
   * change to a plain column with no new SQL function to deploy. Defensive
   * against the column not existing yet (pre-migration) — it degrades to 0
   * rather than throwing on the app's most safety-critical table.
   */
  async recordTourView(userId: string): Promise<number> {
    try {
      const { data, error } = await supabaseAdmin
        .from('users').select('tour_views').eq('id', userId).single();
      if (error || !data) return 0;

      const current = typeof data.tour_views === 'number' ? data.tour_views : 0;
      const next = Math.min(current + 1, 3);
      if (next !== current) {
        await supabaseAdmin.from('users')
          .update({ tour_views: next, updated_at: new Date().toISOString() })
          .eq('id', userId);
      }
      return next;
    } catch {
      return 0;
    }
  }

  /**
   * "Skip all tips" — retire the walkthrough for good by pinning the counter to
   * its cap, so it never plays again on any device.
   */
  async dismissTour(userId: string): Promise<number> {
    try {
      await supabaseAdmin.from('users')
        .update({ tour_views: 3, updated_at: new Date().toISOString() })
        .eq('id', userId);
    } catch { /* non-fatal — the client also stops locally */ }
    return 3;
  }

  async getSubscription(userId: string) {
    const [{ data: user }, { data: sub }] = await Promise.all([
      supabaseAdmin.from('users').select('plan').eq('id', userId).single(),
      supabaseAdmin.from('subscriptions').select('*')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);

    const daysRemaining = sub?.current_period_end
      ? Math.max(0, Math.ceil((new Date(sub.current_period_end).getTime() - Date.now()) / 86_400_000))
      : null;

    return { currentPlan: user?.plan ?? 'free', subscription: sub ? { ...sub, daysRemaining } : null };
  }

  async deleteAccount(userId: string): Promise<void> {
    // Cancel Paystack subscription (non-fatal)
    const { data: sub } = await supabaseAdmin
      .from('subscriptions').select('paystack_subscription_code,paystack_customer_code')
      .eq('user_id', userId).eq('status', 'active').maybeSingle();

    if (sub?.paystack_subscription_code) {
      try {
        const axios   = (await import('axios')).default;
        const { env } = await import('../../config/env');
        await axios.post('https://api.paystack.co/subscription/disable', {
          code: sub.paystack_subscription_code, token: sub.paystack_customer_code,
        }, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
      } catch { /* non-fatal */ }
    }

    // Delete recording files from Supabase Storage
    const { data: recordings } = await supabaseAdmin
      .from('recordings').select('file_url').eq('user_id', userId).not('file_url', 'is', null);

    for (const rec of recordings ?? []) {
      if (!rec.file_url) continue;
      const path = rec.file_url.split('/recordings/')[1];
      if (path) await supabaseAdmin.storage.from('recordings').remove([path]).catch(() => {});
    }

    // FK ON DELETE CASCADE handles all child records
    await supabaseAdmin.from('users').delete().eq('id', userId);
  }
}
