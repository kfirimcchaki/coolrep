import { createHmac, createPublicKey, createVerify, randomBytes, scryptSync, timingSafeEqual, verify as verifySignature } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { cookies, headers } from 'next/headers';
import type { NextResponse } from 'next/server';
import { findSession, findUserById } from './store';
import type { UserRow } from './types';
import { mockConnectSecret, usingMockProvider } from './connect-secret';

export const SESSION_COOKIE = 'nts_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/* ------------------------------------------------------------------ */
/* Secrets                                                             */
/* ------------------------------------------------------------------ */

let cachedSecret: string | null = null;

async function secret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }
  const dir = process.env.DATA_DIR || path.join(process.cwd(), '.data');
  const file = path.join(dir, 'session-secret');
  try {
    cachedSecret = (await fs.readFile(file, 'utf8')).trim();
  } catch {
    cachedSecret = randomBytes(32).toString('hex');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, cachedSecret, { mode: 0o600 });
  }
  return cachedSecret;
}

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

/* ------------------------------------------------------------------ */
/* Session cookies (signed, http-only)                                 */
/* ------------------------------------------------------------------ */

async function sign(value: string): Promise<string> {
  return createHmac('sha256', await secret()).update(value).digest('base64url');
}

export async function encodeSessionCookie(sessionId: string): Promise<string> {
  return `${sessionId}.${await sign(sessionId)}`;
}

export async function decodeSessionCookie(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const index = raw.lastIndexOf('.');
  if (index <= 0) return null;
  const sessionId = raw.slice(0, index);
  const signature = raw.slice(index + 1);
  const expected = await sign(sessionId);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

/** Extracts the raw session id from the cookie jar *or* an Authorization header. */
export async function rawSessionId(): Promise<string | null> {
  const jar = await cookies();
  const fromCookie = await decodeSessionCookie(jar.get(SESSION_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  const headerList = await headers();
  const auth = headerList.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const bearer = auth.slice(7).trim();
    // Accept both a signed cookie value and a bare session id.
    return (await decodeSessionCookie(bearer)) ?? bearer;
  }
  return null;
}

export async function currentUser(): Promise<UserRow | null> {
  const sessionId = await rawSessionId();
  if (!sessionId) return null;
  const session = await findSession(sessionId);
  if (!session) return null;
  return findUserById(session.user_id);
}

/* ------------------------------------------------------------------ */
/* Null's Connect (OIDC id_token flow)                                 */
/* ------------------------------------------------------------------ */

export interface ConnectClaims {
  sub: string;
  email?: string;
  name?: string;
  preferred_username?: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

export function decodeJwt(token: string): { header: Record<string, unknown>; claims: ConnectClaims; signingInput: string; signature: Buffer } {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [encodedHeader, encodedPayload, encodedSig] = parts;
  return {
    header: JSON.parse(b64urlDecode(encodedHeader).toString('utf8')),
    claims: JSON.parse(b64urlDecode(encodedPayload).toString('utf8')),
    signingInput: `${encodedHeader}.${encodedPayload}`,
    signature: b64urlDecode(encodedSig),
  };
}

let jwksCache: { fetchedAt: number; keys: Record<string, unknown>[] } | null = null;

async function jwksKeys(): Promise<Record<string, unknown>[]> {
  const url = process.env.CONNECT_JWKS_URL;
  if (!url) return [];
  if (jwksCache && Date.now() - jwksCache.fetchedAt < 5 * 60_000) return jwksCache.keys;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Record<string, unknown>[] };
  jwksCache = { fetchedAt: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
}

/**
 * Verifies a Null's Connect id_token.
 *
 * Verification order:
 *  1. `CONNECT_JWT_SECRET` (HS256) — used by the bundled mock provider.
 *  2. `CONNECT_JWKS_URL`  (RS256/ES256) — the real provider's key set.
 *  3. `CONNECT_ALLOW_UNVERIFIED=1` decodes the token without checking the
 *     signature (development only, loudly reported in the response headers).
 */
export async function verifyIdToken(token: string): Promise<{ claims: ConnectClaims; verified: boolean }> {
  const { header, claims, signingInput, signature } = decodeJwt(token);

  const alg = String(header.alg ?? '');
  let verified = false;

  const hsSecret = usingMockProvider() ? mockConnectSecret() : process.env.CONNECT_JWT_SECRET;
  if (alg === 'HS256' && hsSecret) {
    const expected = createHmac('sha256', hsSecret).update(signingInput).digest();
    verified = expected.length === signature.length && timingSafeEqual(expected, signature);
    if (!verified) throw new Error('Invalid token signature');
  } else if (alg.startsWith('RS') || alg.startsWith('ES')) {
    const keys = await jwksKeys();
    for (const jwk of keys) {
      try {
        const key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
        const algorithm = alg.startsWith('ES') ? 'sha256' : `sha${alg.slice(2)}`;
        const verifier = alg.startsWith('ES') ? null : createVerify(algorithm);
        if (verifier) {
          verifier.update(signingInput);
          verifier.end();
          if (verifier.verify({ key, dsaEncoding: 'der' }, signature)) {
            verified = true;
            break;
          }
        } else {
          const namedCurve = alg === 'ES256' ? 'P-256' : alg === 'ES384' ? 'P-384' : 'P-521';
          verified = verifySignature(
            namedCurve,
            Buffer.from(signingInput),
            { key, dsaEncoding: 'ieee-p1363' },
            signature,
          );
          if (verified) break;
        }
      } catch {
        /* try the next key */
      }
    }
    if (!verified) throw new Error('Invalid token signature');
  } else if (process.env.CONNECT_ALLOW_UNVERIFIED === '1') {
    verified = false;
  } else {
    throw new Error(`Unsupported token algorithm: ${alg || 'none'}`);
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp + 60 < now) throw new Error('Token expired');
  const expectedIssuer = process.env.CONNECT_ISSUER;
  if (expectedIssuer && claims.iss && claims.iss !== expectedIssuer) {
    throw new Error('Unexpected token issuer');
  }
  const expectedAudience = process.env.CONNECT_CLIENT_ID;
  if (expectedAudience && claims.aud) {
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(expectedAudience)) throw new Error('Unexpected token audience');
  }
  if (!claims.sub && !claims.email) throw new Error('Token has no subject');

  return { claims, verified };
}

/* ------------------------------------------------------------------ */
/* Cookie issuance                                                     */
/* ------------------------------------------------------------------ */

export function isSecureRequest(request: Request): boolean {
  const proto = request.headers.get('x-forwarded-proto');
  if (proto) return proto.split(',')[0].trim() === 'https';
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Creates a session row and returns the signed cookie value. */
export async function issueSession(
  userId: string,
  request: Request,
): Promise<{ cookie: string; sessionId: string; maxAge: number }> {
  const { createSession } = await import('./store');
  const session = await createSession({
    user_id: userId,
    ttlSeconds: SESSION_TTL_SECONDS,
    user_agent: request.headers.get('user-agent'),
    ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null,
  });
  return {
    cookie: await encodeSessionCookie(session.session_id),
    sessionId: session.session_id,
    maxAge: SESSION_TTL_SECONDS,
  };
}

export function applySessionCookie(
  response: NextResponse,
  cookieValue: string,
  maxAge: number,
  secure: boolean,
): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge,
  });
}

export function clearSessionCookie(response: NextResponse, secure: boolean): void {
  response.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: 0,
  });
}
