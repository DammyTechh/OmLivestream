import type { Plan } from '@/store/auth';

/**
 * What each plan may do.
 *
 * Mirrors PLAN_LIMITS in the backend's plans.service.ts, which is the
 * authority. This copy exists only to decide what the app shows and disables —
 * it is a UX concern, not a security boundary. The API enforces the same rules
 * server-side, and it is the API's answer that counts.
 *
 * Keeping the two in step matters more than it looks: a platform greyed out
 * here but allowed by the server is a feature nobody can find, and a platform
 * offered here but refused by the server is an error after the work of setting
 * a stream up.
 *
 * Note 'twitter' — that is the stored identifier for X across the schema, the
 * streams API and the platform list. Only the label changed when the brand did.
 */

export const ALL_PLATFORMS = [
  'youtube', 'facebook', 'instagram', 'tiktok', 'twitch', 'twitter', 'linkedin', 'kick',
] as const;

export const FREE_PLATFORMS = ['youtube', 'twitter'] as const;

export interface Entitlements {
  platforms: readonly string[];
  maxPlatforms: number;
  ai: boolean;
  commentReplies: boolean;
  /** Recording stays on below Premium: a trial has to leave something behind. */
  recording: boolean;
  /** Rear camera and multi-camera are Premium. */
  cameraSwitching: boolean;
}

const PREMIUM: Entitlements = {
  platforms: ALL_PLATFORMS,
  maxPlatforms: 8,
  ai: true,
  commentReplies: true,
  recording: true,
  cameraSwitching: true,
};

const FREE_TRIAL: Entitlements = {
  platforms: FREE_PLATFORMS,
  maxPlatforms: 2,
  ai: false,
  commentReplies: false,
  recording: true,
  cameraSwitching: false,
};

const FREE: Entitlements = { ...FREE_TRIAL, maxPlatforms: 1 };

export function entitlements(plan: Plan | undefined | null): Entitlements {
  if (plan === 'premium') return PREMIUM;
  if (plan === 'free') return FREE;
  return FREE_TRIAL;
}

export const isPremium = (plan: Plan | undefined | null) => plan === 'premium';

export const UPGRADE_COPY = {
  ai:              'AI Studio is part of Premium.',
  commentReplies:  'Replying to comments is part of Premium.',
  cameraSwitching: 'Switching cameras is part of Premium.',
  platforms:       'Free accounts stream to YouTube and X. Premium unlocks all 8 platforms.',
} as const;

/** Display metadata. Brand colours are used only as small identity marks. */
export const PLATFORM_META: Record<string, { label: string; color: string; comments: boolean }> = {
  youtube:   { label: 'YouTube',   color: '#FF0000', comments: true  },
  facebook:  { label: 'Facebook',  color: '#1877F2', comments: true  },
  instagram: { label: 'Instagram', color: '#E4405F', comments: false },
  tiktok:    { label: 'TikTok',    color: '#EE1D52', comments: false },
  twitch:    { label: 'Twitch',    color: '#9146FF', comments: false },
  twitter:   { label: 'X',         color: '#111111', comments: false },
  linkedin:  { label: 'LinkedIn',  color: '#0A66C2', comments: false },
  kick:      { label: 'Kick',      color: '#53FC18', comments: false },
};
