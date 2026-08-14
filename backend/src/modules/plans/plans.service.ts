/**
 * OmliveStream Plan Limits Service
 * ─────────────────────────────────────────────────────────────────
 * Single source of truth for what each plan can and cannot do.
 * All enforcement goes through this service — no scattered checks.
 *
 * Plans:
 *  free_trial → 90 days, 2 platforms, view comments (no replies)
 *  free       → after trial, 1 platform, view comments, upgrade popups
 *  premium    → all platforms, comment replies, unlimited everything
 */

import { supabaseAdmin } from '../../config/supabase';
import { PremiumRequiredError, AppError } from '../../utils/errors';

export type PlanType = 'free_trial' | 'free' | 'premium';

// Hardcoded limits mirror the plan_limits table — no DB roundtrip on every request
/** Every destination the product supports. Premium reaches all of them. */
export const ALL_PLATFORMS = [
  'youtube', 'tiktok', 'instagram', 'facebook', 'twitch', 'twitter', 'linkedin', 'kick',
] as const;

/**
 * Destinations available below Premium.
 *
 * Note 'twitter' — that is the stored identifier for X across the schema and
 * the streams enum; the UI label changed, the column value did not.
 */
export const FREE_PLATFORMS = ['youtube', 'twitter'] as const;

export const PLAN_LIMITS: Record<PlanType, {
  maxStreamPlatforms: number;
  /**
   * WHICH destinations, not just how many. The count limit alone let a free
   * account stream to any two platforms it liked — picking Twitch and TikTok
   * passed every check. Naming the allowed set closes that.
   */
  allowedPlatforms:   readonly string[];
  canReplyComments:   boolean;
  /** AI Studio: assistant, title generation, and AI video editing. */
  canUseAI:           boolean;
  maxStreamsPerDay:   number;
  recordingDays:      number;
  showUpgradePopup:   boolean;
  label:              string;
}> = {
  free_trial: {
    maxStreamPlatforms: 2,
    allowedPlatforms:   FREE_PLATFORMS,
    canReplyComments:   false,
    canUseAI:           false,
    maxStreamsPerDay:   3,
    // Recording stays on below Premium on purpose: someone evaluating the
    // product has to be able to keep what they made, or a trial produces
    // nothing to show for it.
    recordingDays:      30,
    showUpgradePopup:   false,
    label:              'Free Trial',
  },
  free: {
    maxStreamPlatforms: 1,
    allowedPlatforms:   FREE_PLATFORMS,
    canReplyComments:   false,
    canUseAI:           false,
    maxStreamsPerDay:   1,
    recordingDays:      7,
    showUpgradePopup:   true,
    label:              'Free',
  },
  premium: {
    maxStreamPlatforms: 8,
    allowedPlatforms:   ALL_PLATFORMS,
    canReplyComments:   true,
    canUseAI:           true,
    maxStreamsPerDay:   99,
    recordingDays:      365,
    showUpgradePopup:   false,
    label:              'Premium',
  },
};

export interface EffectivePlan {
  plan:          PlanType;
  trialActive:   boolean;
  trialDaysLeft: number | null;
  trialExpired:  boolean;
  limits:        typeof PLAN_LIMITS[PlanType];
}

export interface UpgradePopup {
  show:        boolean;
  type:        'trial_ending' | 'trial_expired' | 'free_limit' | null;
  title:       string;
  message:     string;
  cta:         string;
  ctaUrl:      string;
  daysLeft:    number | null;
  /** trial_ending popups can be dismissed; hard limits cannot */
  dismissible: boolean;
}

const NO_POPUP: UpgradePopup = {
  show: false, type: null, title: '', message: '', cta: '', ctaUrl: '',
  daysLeft: null, dismissible: true,
};

/**
 * Decide which upgrade prompt a plan state warrants.
 *
 * Pure: takes an already-resolved plan rather than a userId, so a caller that
 * has one can render the popup without a second identical `users` read. This
 * matters because /plans/my-plan is documented as being called on every
 * dashboard load — it was the most-repeated query in the system.
 */
export function buildUpgradePopup(info: EffectivePlan): UpgradePopup {
  const { plan, limits, trialDaysLeft, trialExpired, trialActive } = info;

  if (plan === 'premium') return NO_POPUP;

  // Trial ending in 7 days or less
  if (plan === 'free_trial' && trialActive && trialDaysLeft !== null && trialDaysLeft <= 7) {
    return {
      show:        true,
      type:        'trial_ending',
      title:       `Your free trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? 's' : ''}`,
      message:     `Don't lose access to 2-platform streaming. Upgrade now and keep full access — no interruptions.`,
      cta:         'Upgrade to Premium',
      ctaUrl:      '/billing',
      daysLeft:    trialDaysLeft,
      dismissible: true,
    };
  }

  // Trial just expired
  if (trialExpired) {
    return {
      show:        true,
      type:        'trial_expired',
      title:       'Your free trial has ended',
      message:     `You're now on the Free plan (1 platform). Upgrade to Premium to stream to all 8 platforms, reply to comments, and unlock unlimited streams.`,
      cta:         'Upgrade to Premium',
      ctaUrl:      '/billing',
      daysLeft:    0,
      dismissible: false,
    };
  }

  // Free plan hitting limits (shown when they try to add platforms or reply)
  if (plan === 'free' && limits.showUpgradePopup) {
    return {
      show:        true,
      type:        'free_limit',
      title:       'Unlock the full OmliveStream experience',
      message:     `You're on the Free plan — stream to 1 platform with view-only comments. Upgrade to Premium for all 8 platforms, live comment replies, and 365-day recording storage.`,
      cta:         'See Premium Plans',
      ctaUrl:      '/billing',
      daysLeft:    null,
      dismissible: true,
    };
  }

  return NO_POPUP;
}

export class PlansService {

  /**
   * Get effective plan for a user, considering trial expiry.
   * If trial has expired, returns 'free' regardless of DB value.
   *
   * This is the single read every plan decision depends on, so it is also
   * the one most worth not repeating. Callers that need several plan checks
   * in one request should call this once and pass the result down rather
   * than letting each enforcer re-fetch it.
   */
  async getEffectivePlan(userId: string): Promise<EffectivePlan> {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('plan, trial_started_at, trial_expires_at')
      .eq('id', userId)
      .single();

    if (!user) throw new AppError('User not found', 404);

    let plan = (user.plan ?? 'free_trial') as PlanType;
    let trialDaysLeft: number | null = null;
    let trialActive    = false;
    let trialExpired   = false;

    if (plan === 'free_trial' && user.trial_expires_at) {
      const msLeft   = new Date(user.trial_expires_at).getTime() - Date.now();
      trialDaysLeft  = Math.max(0, Math.ceil(msLeft / 86_400_000));
      trialActive    = msLeft > 0;
      trialExpired   = msLeft <= 0;

      if (trialExpired) {
        // Auto-downgrade in DB and use free limits now
        await supabaseAdmin.from('users')
          .update({ plan: 'free', updated_at: new Date().toISOString() })
          .eq('id', userId);
        plan = 'free';
      }
    }

    return {
      plan,
      trialActive,
      trialDaysLeft,
      trialExpired,
      limits: PLAN_LIMITS[plan],
    };
  }

  /**
   * Enforce: how many platforms can this user stream to?
   * Throws a clear error if they exceed their plan limit.
   *
   * `known` lets the go-live path resolve the plan once and run both
   * enforcers against it instead of reading the same row twice.
   */
  async enforcePlatformLimit(userId: string, requestedPlatforms: string[], known?: EffectivePlan): Promise<void> {
    const { plan, limits, trialDaysLeft } = known ?? await this.getEffectivePlan(userId);

    /**
     * Which destinations, checked before how many.
     *
     * The count check on its own was satisfied by any two platforms, so a free
     * account could stream to Twitch and TikTok simply by asking — the UI hides
     * those options, but the UI is not what decides. Rejecting by name first
     * also produces the more useful message: "Twitch is not on your plan" beats
     * "too many platforms" when they picked two.
     */
    const notAllowed = requestedPlatforms.filter((p) => !limits.allowedPlatforms.includes(p));
    if (notAllowed.length > 0) {
      const names = notAllowed.map((p) => (p === 'twitter' ? 'X' : p.charAt(0).toUpperCase() + p.slice(1)));
      throw new AppError(
        `${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} not available on the ${limits.label} plan. ` +
        'Free accounts can stream to YouTube and X. Upgrade to Premium for all 8 platforms.',
        403,
        'PLATFORM_NOT_ALLOWED'
      );
    }

    if (requestedPlatforms.length > limits.maxStreamPlatforms) {
      const trialNote = plan === 'free_trial' && trialDaysLeft !== null
        ? ` Your trial (${trialDaysLeft} days left) allows ${limits.maxStreamPlatforms} platform${limits.maxStreamPlatforms > 1 ? 's' : ''}.`
        : plan === 'free'
          ? ` Your Free plan allows ${limits.maxStreamPlatforms} platform.`
          : '';

      throw new AppError(
        `Your plan allows streaming to ${limits.maxStreamPlatforms} platform${limits.maxStreamPlatforms > 1 ? 's' : ''} at once.${trialNote} Upgrade to Premium for all 8 platforms.`,
        403,
        'PLAN_LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Enforce: can this user reply to comments?
   */
  async enforceCommentReply(userId: string, known?: EffectivePlan): Promise<void> {
    const { limits } = known ?? await this.getEffectivePlan(userId);
    if (!limits.canReplyComments) {
      throw new PremiumRequiredError('Comment replies');
    }
  }

  /**
   * Enforce: can this user use AI Studio at all?
   *
   * Distinct from the daily cap in the AI routes, which rations calls for
   * accounts that are allowed to make them. This decides whether the account
   * is allowed at all — below Premium it is not.
   */
  async enforceAiAccess(userId: string, known?: EffectivePlan): Promise<void> {
    const { limits } = known ?? await this.getEffectivePlan(userId);
    if (!limits.canUseAI) {
      throw new PremiumRequiredError('AI Studio');
    }
  }

  /**
   * Enforce: daily stream count limit.
   */
  async enforceDailyStreamLimit(userId: string, known?: EffectivePlan): Promise<void> {
    const { plan, limits } = known ?? await this.getEffectivePlan(userId);
    if (plan === 'premium') return; // unlimited

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const { count } = await supabaseAdmin
      .from('streams')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', startOfDay.toISOString());

    if ((count ?? 0) >= limits.maxStreamsPerDay) {
      throw new AppError(
        `You have reached your daily limit of ${limits.maxStreamsPerDay} stream${limits.maxStreamsPerDay > 1 ? 's' : ''} on the ${limits.label} plan. Upgrade to Premium for unlimited streams.`,
        403,
        'DAILY_LIMIT_EXCEEDED'
      );
    }
  }

  /**
   * Returns the upgrade popup config for free/trial users.
   * Called by the frontend before or during a live session.
   *
   * Pass `known` when the caller already resolved the plan, to avoid a
   * second identical read.
   */
  async getUpgradePopup(userId: string, known?: EffectivePlan): Promise<UpgradePopup> {
    return buildUpgradePopup(known ?? await this.getEffectivePlan(userId));
  }
}
