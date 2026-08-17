/**
 * Canonical public URLs for each app surface.
 *
 * These are NEXT_PUBLIC_* so they're inlined at build time and usable in
 * client components. Each falls back to a relative-friendly default so
 * local dev (single origin, localhost:3000) keeps working with no config.
 *
 * Use these only for links that must CROSS a subdomain boundary. For
 * navigation inside the current surface, keep using relative paths so
 * Next.js client-side routing stays intact.
 */

const strip = (u: string) => u.replace(/\/+$/, '');

export const SITE_URL      = strip(process.env.NEXT_PUBLIC_SITE_URL      || '');
export const DASHBOARD_URL = strip(process.env.NEXT_PUBLIC_DASHBOARD_URL || '');
export const ADMIN_URL     = strip(process.env.NEXT_PUBLIC_ADMIN_URL     || '');
export const PAYMENT_URL   = strip(process.env.NEXT_PUBLIC_PAYMENT_URL   || '');

// Official contact addresses — surfaced in footers, error states, and
// support prompts.
export const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@omlivestream.com';
export const SALES_EMAIL   = process.env.NEXT_PUBLIC_SALES_EMAIL   || 'sales@omlivestream.com';

/**
 * Official social profiles, surfaced in the footer and in the homepage
 * Organization structured data.
 *
 * Full URLs rather than handles. The previous version derived each URL from a
 * handle, which is tidier but cannot express a Facebook page that has no
 * vanity username — and every handle defaulted to a placeholder, so all six
 * links pointed at profiles that were not ours.
 *
 * These same URLs are emitted as `sameAs` in the homepage JSON-LD, which is how
 * Google ties the accounts to the organisation. That makes accuracy here worth
 * more than tidiness: a wrong URL in `sameAs` associates someone else's account
 * with the brand. Each is env-overridable, and an empty value hides the link.
 */
const social = (v: string | undefined, fallback: string) => (v ?? fallback).trim();

export const SOCIAL_URL = {
  youtube:   social(process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE,   'https://www.youtube.com/@omlivestream_madeeasy'),
  tiktok:    social(process.env.NEXT_PUBLIC_SOCIAL_TIKTOK,    'https://www.tiktok.com/@omlivestreammade'),
  instagram: social(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM, 'https://www.instagram.com/omlivestream_madeeasy'),
  // A /share/ link, not a vanity URL. It resolves, but a canonical
  // facebook.com/<pagename> URL is a stronger `sameAs` signal — set the env var
  // once the Page has a username.
  facebook:  social(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK,  'https://www.facebook.com/share/1GnjmjSrtF/'),
  x:         social(process.env.NEXT_PUBLIC_SOCIAL_X,         'https://x.com/omlive_stream'),
  threads:   social(process.env.NEXT_PUBLIC_SOCIAL_THREADS,   'https://www.threads.com/@omlivestream_madeeasy'),
} as const;

export type SocialKey = keyof typeof SOCIAL_URL;

/** Handles, derived from the URLs above — used for display (@name) only. */
export const SOCIAL_HANDLE: Record<SocialKey, string> = Object.fromEntries(
  Object.entries(SOCIAL_URL).map(([k, url]) => {
    const last = url.replace(/\/+$/, '').split('/').pop() ?? '';
    return [k, last.replace(/^@/, '').split('?')[0]];
  }),
) as Record<SocialKey, string>;
