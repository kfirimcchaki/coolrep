import { createHmac } from 'node:crypto';
import { mockConnectSecret } from './connect-secret';

/**
 * A tiny, self-contained identity provider that behaves like Null's Connect:
 * it shows a "Sign in / Enter your email address" screen and redirects back to
 * the app with an `id_token` in the URL fragment, exactly like the real
 * provider (response_type=id_token).
 *
 * It exists so the clone's login flow is fully functional offline. Point
 * CONNECT_MOCK=0 (or CONNECT_AUTHORIZE_URL) at the real provider to use it
 * instead.
 */
export function mockSecret(): string {
  return mockConnectSecret();
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface MockClaims {
  iss: string;
  aud: string;
  sub: string;
  email: string;
  name: string;
  preferred_username: string;
  iat: number;
  exp: number;
}

export function signIdToken(claims: MockClaims): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'mock-connect' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createHmac('sha256', mockSecret()).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Stable subject + handle derived from an email address. */
export function claimsForEmail(email: string, clientId: string, issuer: string): MockClaims {
  const normalized = email.trim().toLowerCase();
  const local = normalized.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'user';
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    aud: clientId,
    sub: `mock-connect|${createHmac('sha256', mockSecret()).update(normalized).digest('hex').slice(0, 32)}`,
    email: normalized,
    name: local,
    preferred_username: local,
    iat: now,
    exp: now + 600,
  };
}
