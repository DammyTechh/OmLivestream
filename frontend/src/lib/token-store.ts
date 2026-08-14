'use client';

/**
 * Where auth tokens live.
 *
 * They used to live in localStorage, which is scoped to a single *origin*.
 * The product is spread across dashboard., payment. and admin.omlivestream.com,
 * so a token written while signing in on one of them did not exist on any of
 * the others: leaving the dashboard for checkout landed on a subdomain with an
 * empty store, AuthGuard found no token, and the creator was bounced to the
 * sign-in screen — which is exactly what happened returning from Paystack after
 * a successful payment.
 *
 * Cookies scope by *domain* rather than origin, so one written for
 * `.omlivestream.com` is visible to every subdomain under it. Tokens therefore
 * live in cookies and cross freely.
 *
 * Two deliberate limits:
 *
 *   • Only tokens move to cookies. The cached user profile stays in
 *     localStorage — it is several hundred bytes of JSON, cookies are capped
 *     around 4KB and ride on every request, and the profile is re-fetched from
 *     /users/me on load anyway. Sharing it would buy nothing and risk the cap.
 *
 *   • This is not a security upgrade. A JS-readable cookie is exposed to XSS
 *     the same way localStorage is; the change is about scope, not hardening.
 *     Genuine hardening means httpOnly cookies set by the API, which the
 *     backend would have to issue and is a larger change than this.
 *
 * Reads check the cookie first and fall back to localStorage, so anyone already
 * signed in when this ships keeps their session and is migrated on next load
 * rather than being logged out.
 */

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

/**
 * The widest domain we may legitimately scope a cookie to.
 *
 * `omlivestream.com` → `.omlivestream.com` (shared by every subdomain).
 * `localhost`, an IP, or a preview host → null, meaning a host-only cookie.
 * Returning null rather than guessing matters: a cookie scoped to a public
 * suffix (`.com`, `.vercel.app`) is rejected by the browser, and silently
 * getting no cookie at all is worse than the localStorage fallback.
 */
function cookieDomain(): string | null {
  if (!isBrowser()) return null;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  const parts = host.split('.');
  if (parts.length < 2) return null;

  // Take the registrable pair (example.com). Deliberately simple: this app is
  // served from one known apex, and a full public-suffix list is overkill.
  const apex = parts.slice(-2).join('.');
  // Preview/platform hosts are multi-tenant — never scope a cookie that wide.
  if (['vercel.app', 'netlify.app', 'onrender.com', 'github.io'].includes(apex)) return null;
  return `.${apex}`;
}

const MAX_AGE = 60 * 60 * 24 * 30; // 30 days, matching refresh-token lifetime

function writeCookie(name: string, value: string) {
  if (!isBrowser()) return;
  const domain = cookieDomain();
  const secure = window.location.protocol === 'https:' ? '; secure' : '';
  // SameSite=Lax keeps the cookie on top-level navigations back from Paystack,
  // which is precisely the journey that was breaking, while still refusing to
  // ride along on cross-site subrequests.
  document.cookie =
    `${name}=${encodeURIComponent(value)}; path=/; max-age=${MAX_AGE}; samesite=lax` +
    (domain ? `; domain=${domain}` : '') + secure;
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&')}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function clearCookie(name: string) {
  if (!isBrowser()) return;
  const domain = cookieDomain();
  // Expire it on both the scoped domain and host-only: an older host-only
  // cookie left behind would keep shadowing the shared one after sign-out.
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax` + (domain ? `; domain=${domain}` : '');
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

export const tokenStore = {
  get(key: string): string | null {
    if (!isBrowser()) return null;
    const fromCookie = readCookie(key);
    if (fromCookie) return fromCookie;

    // Migrate a pre-existing localStorage session into the shared cookie so
    // signed-in users are carried across rather than logged out.
    try {
      const legacy = localStorage.getItem(key);
      if (legacy) { writeCookie(key, legacy); return legacy; }
    } catch { /* storage unavailable */ }
    return null;
  },

  set(key: string, value: string) {
    writeCookie(key, value);
    // Mirrored locally as a fallback for browsers blocking third-party-ish
    // cookie writes; the cookie remains the source of truth.
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },

  remove(key: string) {
    clearCookie(key);
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
