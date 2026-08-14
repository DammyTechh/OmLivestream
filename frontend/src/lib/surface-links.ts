import { DASHBOARD_URL, PAYMENT_URL, ADMIN_URL, SITE_URL } from './urls';

/**
 * Links that cross from one surface (subdomain) to another.
 *
 * A relative `/payment` link is resolved against whatever host the page is
 * currently served from. On dashboard.omlivestream.com that means requesting
 * `/payment` from the dashboard host, which the middleware maps into
 * `/dashboard/payment` — a route that does not exist. That is the 404 people
 * hit opening checkout from Billing.
 *
 * These helpers return the absolute URL of the surface that actually owns the
 * page, and fall back to the relative path when the env var is unset so local
 * development on a single origin keeps working unchanged.
 */

const join = (base: string, path: string) =>
  base ? `${base.replace(/\/+$/, '')}${path}` : path;

/** Checkout, e.g. paymentUrl('?plan=premium'). */
export const paymentUrl = (query = '') =>
  PAYMENT_URL ? join(PAYMENT_URL, '') + (query || '/') : `/payment${query}`;

/** A page inside the dashboard, e.g. dashboardUrl('/billing'). */
export const dashboardUrl = (path = '') =>
  DASHBOARD_URL ? join(DASHBOARD_URL, path) : `/dashboard${path}`;

/** A page inside the admin area. */
export const adminUrl = (path = '') =>
  ADMIN_URL ? join(ADMIN_URL, path) : `/admin${path}`;

/** A page on the marketing site. */
export const siteUrl = (path = '/') => join(SITE_URL, path);
