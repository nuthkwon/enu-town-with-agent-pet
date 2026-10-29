import { getSessionCookie } from 'better-auth/cookies';
import { NextResponse, type NextRequest } from 'next/server';
import { buildCsp, redirectOrigin } from '@/lib/csp';

/**
 * Next 16 proxy (formerly middleware):
 *  1. App pages need a session: without the session cookie, the messenger (/, /pets, /people, /all, /dm,
 *     /settings), /town, /me, /admin and /welcome redirect to /sign-in?next=… (cookie presence only — every
 *     page re-validates the session itself). The path is passed on as `x-den-path` for the den layout's own
 *     sign-in redirect (a layout does not know its page's path).
 *  2. A per-request CSP with a script nonce (Next applies it to its own scripts automatically).
 * API routes, OAuth discovery and static assets are excluded by the matcher.
 */

const PROTECTED_PREFIXES = [
  '/pets',
  '/people',
  '/all',
  '/dm',
  '/settings',
  '/town',
  '/me',
  '/admin',
  '/welcome',
];

function isProtected(pathname: string): boolean {
  if (pathname === '/') return true;
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isProtected(pathname) && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = '/sign-in';
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const dev = process.env.NODE_ENV === 'development';
  // The consent page's no-JS form fallback ends in a redirect to the client's redirect_uri,
  // and browsers apply form-action to redirects after a form submission.
  const formActionOrigins: string[] = [];
  if (pathname === '/consent') {
    const origin = redirectOrigin(request.nextUrl.searchParams.get('redirect_uri'));
    if (origin) formActionOrigins.push(origin);
  }
  const csp = buildCsp({
    nonce,
    dev,
    realtimeUrl: process.env.REALTIME_PUBLIC_URL,
    formActionOrigins,
    selfOrigin: request.nextUrl.origin,
    upgradeInsecureRequests: (process.env.PUBLIC_URL ?? '').startsWith('https://'),
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-den-path', pathname + search);
  requestHeaders.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        '/((?!api/|\\.well-known/|_next/static|_next/image|favicon\\.ico|assets/|fonts/|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?|json|tmj|txt|map)$).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
