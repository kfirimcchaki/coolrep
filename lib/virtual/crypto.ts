/**
 * Browser-safe crypto primitives used by the static (GitHub Pages) build.
 * No node: imports — everything runs on Web Crypto.
 */

const encoder = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlEncodeJson(value: unknown): string {
  return b64url(encoder.encode(JSON.stringify(value)));
}

export function b64urlDecode(input: string): Uint8Array<ArrayBuffer> {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function b64urlDecodeJson<T = unknown>(input: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(input))) as T;
}

/* ------------------------------------------------------------------ */
/* UUIDv7                                                             */
/* ------------------------------------------------------------------ */

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

/** Time-ordered UUID, identical in shape to the upstream identifiers. */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  let ms = BigInt(Date.now());
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidv4(): string {
  return crypto.randomUUID();
}

export function opaqueToken(bytes = 18): string {
  return b64url(randomBytes(bytes));
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/* ------------------------------------------------------------------ */
/* Timestamps (microsecond ISO, same format as the server build)      */
/* ------------------------------------------------------------------ */

export function nowIso(): string {
  const base = new Date().toISOString();
  const [head, rest] = base.split('.');
  const millis = (rest ?? '000Z').slice(0, 3).padEnd(3, '0');
  const micros = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${head}.${millis}${micros}Z`;
}

/* ------------------------------------------------------------------ */
/* Password hashing (PBKDF2-SHA256 — scrypt is not exposed in browsers)*/
/* ------------------------------------------------------------------ */

const PBKDF2_ITERATIONS = 120_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(derived))}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split('$');
  if (scheme !== 'pbkdf2' || !saltRaw || !hashRaw) return false;
  const iterations = Number(iterationsRaw) || PBKDF2_ITERATIONS;
  const salt = b64urlDecode(saltRaw);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256),
  ) as Uint8Array<ArrayBuffer>;
  const expected = b64urlDecode(hashRaw);
  if (expected.length !== derived.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ derived[i];
  return diff === 0;
}

/* ------------------------------------------------------------------ */
/* HS256 id_tokens (bundled Null's Connect provider)                  */
/* ------------------------------------------------------------------ */

export const MOCK_CONNECT_SECRET = 'nt-scripting-local-mock-connect-secret';

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
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

export async function signIdToken(claims: MockClaims, secret = MOCK_CONNECT_SECRET): Promise<string> {
  const header = b64urlEncodeJson({ alg: 'HS256', typ: 'JWT', kid: 'mock-connect' });
  const payload = b64urlEncodeJson(claims);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(signature))}`;
}

export async function claimsForEmail(email: string, clientId: string, issuer: string): Promise<MockClaims> {
  const normalized = email.trim().toLowerCase();
  const local = normalized.split('@')[0].replace(/[^a-z0-9_]/g, '') || 'user';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalized));
  const subject = b64url(new Uint8Array(digest)).slice(0, 32);
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: issuer,
    aud: clientId,
    sub: `mock-connect|${subject}`,
    email: normalized,
    name: local,
    preferred_username: local,
    iat: now,
    exp: now + 600,
  };
}

export async function verifyIdToken(
  token: string,
  options: { secret?: string; issuer?: string; audience?: string } = {},
): Promise<{ claims: MockClaims; verified: boolean }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = b64urlDecodeJson<{ alg?: string }>(encodedHeader);
  if (header.alg !== 'HS256') throw new Error(`Unsupported token algorithm: ${header.alg ?? 'none'}`);

  const signature = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(options.secret ?? MOCK_CONNECT_SECRET),
    b64urlDecode(encodedSignature),
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!signature) throw new Error('Invalid token signature');

  const claims = b64urlDecodeJson<MockClaims>(encodedPayload);
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && claims.exp + 60 < now) throw new Error('Token expired');
  if (options.issuer && claims.iss !== options.issuer) throw new Error('Unexpected token issuer');
  if (options.audience && claims.aud !== options.audience) throw new Error('Unexpected token audience');
  if (!claims.sub && !claims.email) throw new Error('Token has no subject');
  return { claims, verified: true };
}
