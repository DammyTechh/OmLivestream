import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Subdomain routing.
 *
 * The app ships as one Next.js deployment but is served under several
 * hostnames. Each subdomain maps onto an existing route segment:
 *
 *   dashboard.omlivestream.com/streams  ->  /dashboard/streams
 *   admin.omlivestream.com/users        ->  /admin/users
 *   payment.omlivestream.com/           ->  /payment
 *   www.omlivestream.com/               ->  /            (unchanged)
 *
 * This is a rewrite, not a redirect: the URL in the address bar keeps the
 * subdomain, so links and bookmarks stay clean while the App Router still
 * resolves the existing directories under src/app.
 */

// Path prefixes that mean the same thing on every hostname and must never
// be rewritten into a subdomain segment.
const SHARED_PREFIXES = [
  '/auth',
  '/onboarding',
  '/waitlist',
  '/_next',
  '/api',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

// Subdomain -> route segment it maps onto.
const SUBDOMAIN_ROUTES: Record<string, string> = {
  dashboard: '/dashboard',
  admin: '/admin',
  payment: '/payment',
};

export function middleware(req: NextRequest) {
  const host = req.headers.get('host') ?? '';
  const { pathname } = req.nextUrl;

  // Strip port (localhost:3000) before reading the label.
  const hostname = host.split(':')[0];
  const label = hostname.split('.')[0].toLowerCase();

  const segment = SUBDOMAIN_ROUTES[label];

  // Apex, www, the Vercel URL, and localhost all serve the app as-is.
  if (!segment) return NextResponse.next();

  // Static assets and shared auth flows pass through untouched.
  if (SHARED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Already pointing at the right segment — don't double-prefix
  // (/dashboard/streams must not become /dashboard/dashboard/streams).
  if (pathname === segment || pathname.startsWith(`${segment}/`)) {
    return NextResponse.next();
  }

  const url = req.nextUrl.clone();
  url.pathname = pathname === '/' ? segment : `${segment}${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Run on everything except Next internals and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
