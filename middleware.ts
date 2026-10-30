import { NextResponse, type NextRequest } from 'next/server';
import { buildAuthorizeUrl, OAUTH_STATE_COOKIE, randomState } from './lib/connect-url';

/**
 * Mirrors the CORS behaviour of the original API gateway, which answers with:
 *   access-control-allow-credentials: true
 *   vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
 * and only echoes an Access-Control-Allow-Origin for trusted origins
 * (credentials + wildcard is not a legal combination).
 *
 * It also implements the server-side half of the Null's Connect flow: a plain
 * `GET /connect` issues a 302 to the provider's /authorize endpoint, while the
 * provider's redirect back to `/connect#id_token=…` is served to the page.
 */
const DEFAULT_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
const RETURN_TO_COOKIE = 'nts_return_to';

function isAllowedOrigin(origin: string): boolean {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const allowlist = configured.length ? configured : DEFAULT_ORIGINS;
  if (allowlist.includes('*')) return true;
  if (allowlist.includes(origin)) return true;
  if (/^https:\/\/[a-z0-9-]+\.e2b\.app$/i.test(origin)) return true;
  if (process.env.APP_URL && origin === process.env.APP_URL.replace(/\/$/, '')) return true;
  return false;
}

/** Public origin, honouring the reverse proxy headers used in preview/production. */
function requestOrigin(request: NextRequest): string {
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    request.nextUrl.protocol.replace(':', '');
  const host =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() || request.headers.get('host');
  if (host) return `${proto}://${host}`;
  return request.nextUrl.origin;
}

function sanitizeReturnTo(value: string | null): string {
  if (!value) return '/scripts';
  if (!value.startsWith('/') || value.startsWith('//')) return '/scripts';
  return value;
}

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  /* ---------------- Null's Connect entry point ---------------- */
  if (path === '/connect' && request.method === 'GET') {
    const restart = request.nextUrl.searchParams.get('restart') === '1';
    const existing = request.cookies.get(OAUTH_STATE_COOKIE)?.value;

    if (!existing || restart) {
      const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get('return_to'));
      const state = randomState();
      const origin = requestOrigin(request);
      const authorizeUrl = buildAuthorizeUrl(returnTo, state, origin);
      const response = NextResponse.redirect(authorizeUrl, 302);
      const secure = origin.startsWith('https:');
      response.cookies.set(OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 600,
      });
      response.cookies.set(RETURN_TO_COOKIE, returnTo, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 600,
      });
      return response;
    }
  }

  /* ---------------- CORS for /api/* ---------------- */
  const isApi = path.startsWith('/api/');
  if (!isApi) return NextResponse.next();

  const origin = request.headers.get('origin');

  if (request.method === 'OPTIONS') {
    const preflight = new NextResponse(null, { status: 204 });
    applyCors(preflight.headers, origin);
    preflight.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    preflight.headers.set(
      'Access-Control-Allow-Headers',
      request.headers.get('access-control-request-headers') || 'content-type,authorization',
    );
    preflight.headers.set('Access-Control-Max-Age', '600');
    return preflight;
  }

  const response = NextResponse.next();
  applyCors(response.headers, origin);
  return response;
}

function applyCors(headers: Headers, origin: string | null) {
  headers.set('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers');
  headers.set('Access-Control-Allow-Credentials', 'true');
  if (origin && isAllowedOrigin(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
}

export const config = {
  matcher: ['/api/:path*', '/connect'],
};
