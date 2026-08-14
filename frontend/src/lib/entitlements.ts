import type { Plan } from '@/store/auth';

/**
 * What each plan can do, in one place.
 *
 * These rules were previously implied in scattered places — a sentence under
 * the platform picker, a check on one page but not another — which is how a
 * free account ends up seeing a feature it cannot use and only finding out
 * after it fails. Everything that gates on plan reads from here.
 *
 * Note this is the *client* view of entitlement: it decides what to show and
 * what to disable, which is a UX concern. It is not a security boundary — the
 * API must enforce the same rules server-side, since anything decided in the
 * browser can be bypassed.
 */

/**
 * Platforms a free/trial account may broadcast to.
 *
 * 'twitter' is the stored identifier for X everywhere — the database enum, the
 * streams API, and the platform list in the UI. Only the label changed when the
 * brand did. Writing 'x' here silently locks X for every free account, since
 * nothing in the picker has that id.
 *
 * These mirror PLAN_LIMITS in the backend's plans.service.ts, which is the
 * authority; this copy only decides what to show and disable.
 */
export const FREE_PLATFORMS = ['youtube', 'twitter'] as const;

export interface Entitlements {
  /** Platform ids this account may stream to. */
  platforms: readonly string[];
  /** Maximum simultaneous destinations. */
  maxPlatforms: number;
  /** AI Studio: assistant, title generation, AI video editing. */
  ai: boolean;
  /** Replying to viewer comments from the unified inbox. */
  commentReplies: boolean;
  /** Broadcasts are recorded and kept — available to everyone. */
  recording: boolean;
  /** Switching to the rear camera / running two cameras. */
  cameraSwitching: boolean;
}

const PREMIUM: Entitlements = {
  platforms: ['youtube', 'facebook', 'instagram', 'tiktok', 'twitch', 'twitter', 'linkedin', 'kick'],
  maxPlatforms: 8,
  ai: true,
  commentReplies: true,
  recording: true,
  cameraSwitching: true,
};

/** Trial: two destinations. Matches PLAN_LIMITS.free_trial. */
const FREE_TRIAL: Entitlements = {
  platforms: FREE_PLATFORMS,
  maxPlatforms: 2,
  ai: false,
  commentReplies: false,
  // Recording stays on for free accounts deliberately: someone evaluating the
  // product needs to be able to keep what they made, or the trial produces
  // nothing they can show for it.
  recording: true,
  // Front camera only — rear switching and dual capture are premium.
  cameraSwitching: false,
};

/**
 * After the trial lapses the allowance narrows to a single destination —
 * PLAN_LIMITS.free in the backend. Mirrored here so the picker stops someone
 * before the API has to.
 */
const FREE: Entitlements = { ...FREE_TRIAL, maxPlatforms: 1 };

export function entitlements(plan: Plan | undefined | null): Entitlements {
  if (plan === 'premium') return PREMIUM;
  if (plan === 'free') return FREE;
  return FREE_TRIAL;
}

export const isPremium = (plan: Plan | undefined | null) => plan === 'premium';

/** Shown wherever a locked feature is surfaced, so the reason is never a mystery. */
export const UPGRADE_COPY = {
  ai:              'AI Studio is part of Premium.',
  commentReplies:  'Replying to comments is part of Premium.',
  cameraSwitching: 'Switching cameras is part of Premium.',
  platforms:       'Free accounts can stream to YouTube and X. Premium unlocks all 8 platforms.',
} as const;
