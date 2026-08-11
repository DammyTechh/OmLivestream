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
 * Official social profiles, surfaced in the footer.
 *
 * Env-overridable and keyed by handle, not full URL, so the handle is stated
 * once and each platform's URL shape lives in one place. An empty value hides
 * that link entirely — better a short row of real links than a full row where
 * half 404. Set NEXT_PUBLIC_SOCIAL_* to change a handle without a code edit.
 */
const handle = (v: string | undefined, fallback: string) =>
  (v ?? fallback).replace(/^@/, '').trim();

export const SOCIAL_HANDLE = {
  youtube:   handle(process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE,   'omlivestream'),
  tiktok:    handle(process.env.NEXT_PUBLIC_SOCIAL_TIKTOK,    'omlivestream'),
  instagram: handle(process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM, 'omlivestream'),
  facebook:  handle(process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK,  'omlivestream'),
  x:         handle(process.env.NEXT_PUBLIC_SOCIAL_X,         'omlivestream'),
  threads:   handle(process.env.NEXT_PUBLIC_SOCIAL_THREADS,   'omlivestream'),
} as const;

export type SocialKey = keyof typeof SOCIAL_HANDLE;

export const SOCIAL_URL: Record<SocialKey, string> = {
  youtube:   `https://www.youtube.com/@${SOCIAL_HANDLE.youtube}`,
  tiktok:    `https://www.tiktok.com/@${SOCIAL_HANDLE.tiktok}`,
  instagram: `https://www.instagram.com/${SOCIAL_HANDLE.instagram}`,
  facebook:  `https://www.facebook.com/${SOCIAL_HANDLE.facebook}`,
  x:         `https://x.com/${SOCIAL_HANDLE.x}`,
  threads:   `https://www.threads.net/@${SOCIAL_HANDLE.threads}`,
};
