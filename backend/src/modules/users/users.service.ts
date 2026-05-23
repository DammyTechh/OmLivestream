import { supabaseAdmin } from '../../config/supabase';
import { NotFoundError, ValidationError } from '../../utils/errors';

export class UsersService {

  async getProfile(userId: string) {
    const { data, error } = await supabaseAdmin
      .from('users').select('*').eq('id', userId).single();
    if (error || !data) throw new NotFoundError('User');
    return data;
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
