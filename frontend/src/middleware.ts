import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Subdomain routing.
 *
 * One Next.js deployment served under several hostnames, where each subdomain
 * maps onto a route segment:
 *
 *   dashboard.omlivestream.com/streams  ->  /dashboard/streams
 *   admin.omlivestream.com/users        ->  /admin/users
 *   payment.omlivestream.com/           ->  /payment
 *
 * The mapping is a rewrite, so the address bar keeps the subdomain while the
 * App Router still resolves the directories under src/app.
 *
 * Three things this has to get right, each of which previously broke:
 *
 *  1. STATIC FILES. `/logo-mark.webp` on the dashboard host was being rewritten
 *     to `/dashboard/logo-mark.webp`, which does not exist — so the logo, and
 *     anything else served from public/, 404'd on every subdomain. Any path
 *     with a file extension is now left alone.
 *
 *  2. CROSS-SURFACE LINKS. A relative link to `/payment` from the dashboard
 *     host became `/dashboard/payment` and 404'd — which is exactly what
 *     happened opening checkout from Billing. Paths belonging to a *different*
 *     surface are now redirected to that surface's own host instead.
 *
 *  3. ONE CANONICAL HOME PER SURFACE. The apex also answered on
 *     `omlivestream.com/dashboard` and `/admin`, so every page had two working
 *     URLs — bad for sessions, bookmarks and search. The apex now redirects
 *     those to the proper subdomain.
 */

// Prefixes that mean the same thing on every hostname.
const SHARED_PREFIXES = [
  '/auth',
  '/onboarding',
  '/waitlist',
  '/_next',
  '/api',
];

// Subdomain label -> route segment.
const SUBDOMAIN_ROUTES: Record<string, string> = {
  dashboard: '/dashboard',
  admin: '/admin',
  payment: '/payment',
};

/** Hostnames for each surface, from env. Empty in local dev, which disables cross-host redirects. */
const HOSTS: Record<string, string> = {
  '/dashboard': process.env.NEXT_PUBLIC_DASHBOARD_URL || '',
  '/admin':     process.env.NEXT_PUBLIC_ADMIN_URL     || '',
  '/payment':   process.env.NEXT_PUBLIC_PAYMENT_URL   || '',
};

/** A request for a file (has an extension in its last segment) — never rewrite these. */
function isFileRequest(pathname: string): boolean {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
}

function isShared(pathname: string): boolean {
  return SHARED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Which surface a path belongs to, if any. */
function segmentFor(pathname: string): string | null {
  for (const segment of Object.values(SUBDOMAIN_ROUTES)) {
    if (pathname === segment || pathname.startsWith(`${segment}/`)) return segment;
  }
  return null;
}

/**
 * Send the visitor to the same path on the surface that owns it, preserving the
 * query string — a checkout link carrying ?plan=premium must not lose it.
 */
function redirectToSurface(req: NextRequest, segment: string, pathname: string) {
  const base = HOSTS[segment];
  if (!base) return null; // not configured (local dev) — leave it alone
  const rest = pathname.slice(segment.length) || '/';
  const target = new URL(`${base.replace(/\/+$/, '')}${rest === '/' ? '' : rest}`);
  target.search = req.nextUrl.search;
  return NextResponse.redirect(target);
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  // Files and shared flows are identical on every host.
  if (isFileRequest(pathname) || isShared(pathname)) return NextResponse.next();

  const hostname = host.split(':')[0];
  const label = hostname.split('.')[0].toLowerCase();
  const segment = SUBDOMAIN_ROUTES[label];

  // ── On the apex / www ────────────────────────────────────────────
  // Give each surface exactly one home by sending /dashboard, /admin and
  // /payment to their own subdomains.
  if (!segment) {
    const owner = segmentFor(pathname);
    if (owner) {
      const redirect = redirectToSurface(req, owner, pathname);
      if (redirect) return redirect;
    }
    return NextResponse.next();
  }

  // ── On a subdomain ───────────────────────────────────────────────
  // Already inside its own segment: serve as-is.
  if (pathname === segment || pathname.startsWith(`${segment}/`)) return NextResponse.next();

  // Path belongs to a different surface — hand it over rather than rewriting
  // it into a route that does not exist here.
  const owner = segmentFor(pathname);
  if (owner && owner !== segment) {
    const redirect = redirectToSurface(req, owner, pathname);
    if (redirect) return redirect;
  }

  const url = req.nextUrl.clone();
  url.pathname = pathname === '/' ? segment : `${segment}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
