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
