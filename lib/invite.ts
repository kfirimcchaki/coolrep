/**
 * Friendly-battle invites and cross-site script borrowing.
 *
 * A Null's Brawl "script room" invite decodes to a small JSON document:
 *
 *   {
 *     "realm": "experiment:scripts",
 *     "script": "https://scripting.nulls.gg/api/scripts/<uuid>/content?token=<jwt>",
 *     "bp": [0, 0, 0, 0, 0, 0, 254, 1, 1, -600, …]
 *   }
 *
 * `realm` selects the game realm, `script` is a **self-contained** download URL
 * and `bp` is the battle-parameter vector the room is created with. The URL
 * carries its own proof of access: an HS256 JWT with
 * `{ script_id, revision_id, exp }`, so the client that opens the room can read
 * the source without an account.
 *
 * Because the document only names a URL, *any* host can serve it — that is what
 * lets another site (this clone included) hand a script to the game:
 *
 *   - we mint the same tokens (`signContentToken`) and serve the same path
 *     (`GET /api/scripts/{id}/content?token=…`);
 *   - we produce the same invite document (`buildInvite`);
 *   - we can read documents from any other site (`decodeInvite` + fetch) and
 *     import the script into an account here.
 *
 * The module is isomorphic: Web Crypto only, so Node (route handlers) and the
 * browser (the static build's in-browser backend) share one implementation.
 */

export const INVITE_REALM = 'experiment:scripts';

/** Default battle-parameter vector observed in real invites. */
export const DEFAULT_BP: readonly number[] = [
  0, 0, 0, 0, 0, 0, 254, 1, 1, -600, 1000, -20, 20, 1, 3, 0, 1, 1, 1, 1000, 1, 0, 0, 0, 100, 0, 0, 1, 1000,
  1000, 1000, 1,
];

/** How long a content URL stays valid. The observed tokens lived ~15 minutes. */
export const DEFAULT_INVITE_TTL_SECONDS = 900;

export const DEFAULT_CONTENT_SECRET = 'nt-scripting-local-content-secret';

export interface ContentClaims {
  script_id: string;
  revision_id: number;
  exp: number;
  iat?: number;
  /** Optional audience/issuer, used when a deployment wants its own scope. */
  iss?: string;
  aud?: string;
}

export interface InvitePayload {
  realm: string;
  script: string;
  bp: number[];
}

export class InviteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'InviteError';
  }
}

/* ------------------------------------------------------------------ */
/* base64url                                                           */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (globalThis as any).Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): Uint8Array<ArrayBuffer> {
  const normalised = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  if (typeof atob === 'function') {
    const binary = atob(padded);
    const bytes = new Uint8Array(new ArrayBuffer(binary.length));
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromNode = (globalThis as any).Buffer.from(padded, 'base64') as Uint8Array;
  const copy = new Uint8Array(new ArrayBuffer(fromNode.length));
  copy.set(fromNode);
  return copy;
}

function encodeJson(value: unknown): string {
  return toBase64Url(encoder.encode(JSON.stringify(value)));
}

function decodeJson<T>(input: string): T {
  return JSON.parse(decoder.decode(fromBase64Url(input))) as T;
}

/* ------------------------------------------------------------------ */
/* Content tokens (HS256 JWT)                                          */
/* ------------------------------------------------------------------ */

export function contentSecret(): string {
  const fromEnv = typeof process !== 'undefined' ? process.env?.NTS_CONTENT_SECRET : undefined;
  return fromEnv || DEFAULT_CONTENT_SECRET;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** Mints the token that a content URL carries (`{script_id, revision_id, exp}`). */
export async function signContentToken(
  claims: { script_id: string; revision_id: number; ttlSeconds?: number; iss?: string; aud?: string },
  secret = contentSecret(),
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const body: ContentClaims = {
    script_id: claims.script_id,
    revision_id: claims.revision_id,
    exp: now + (claims.ttlSeconds ?? DEFAULT_INVITE_TTL_SECONDS),
    iat: now,
  };
  if (claims.iss) body.iss = claims.iss;
  if (claims.aud) body.aud = claims.aud;

  // Header key order matches the tokens seen in the wild.
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'HS256' })));
  const payload = encodeJson(body);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Verifies a content token. Throws `InviteError` with a matching status. */
export async function verifyContentToken(
  token: string,
  options: { secret?: string; now?: number; issuer?: string; audience?: string } = {},
): Promise<ContentClaims> {
  if (typeof token !== 'string' || token.split('.').length !== 3) {
    throw new InviteError('Invalid token', 401);
  }
  const [header, payload, signature] = token.split('.');

  let parsedHeader: { alg?: string; typ?: string };
  try {
    parsedHeader = decodeJson<{ alg?: string; typ?: string }>(header);
  } catch {
    throw new InviteError('Invalid token', 401);
  }
  if (parsedHeader.alg !== 'HS256') {
    throw new InviteError(`Unsupported token algorithm: ${parsedHeader.alg ?? 'none'}`, 401);
  }

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(options.secret ?? contentSecret()),
      fromBase64Url(signature),
      encoder.encode(`${header}.${payload}`),
    );
  } catch {
    valid = false;
  }
  if (!valid) throw new InviteError('Invalid token signature', 401);

  let claims: ContentClaims;
  try {
    claims = decodeJson<ContentClaims>(payload);
  } catch {
    throw new InviteError('Invalid token payload', 401);
  }

  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number') throw new InviteError('Token has no expiry', 401);
  if (claims.exp <= now) throw new InviteError('Token expired', 401);
  if (typeof claims.script_id !== 'string') throw new InviteError('Token has no script', 401);
  if (typeof claims.revision_id !== 'number') throw new InviteError('Token has no revision', 401);
  if (options.issuer && claims.iss !== options.issuer) throw new InviteError('Unexpected token issuer', 401);
  if (options.audience && claims.aud !== options.audience) throw new InviteError('Unexpected token audience', 401);

  return claims;
}

/* ------------------------------------------------------------------ */
/* Invite documents                                                    */
/* ------------------------------------------------------------------ */

export function normaliseBp(value: unknown): number[] {
  if (value === undefined || value === null) return [...DEFAULT_BP];
  if (!Array.isArray(value)) throw new InviteError('bp must be an array of numbers');
  const bp = value.map((entry) => {
    const num = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isFinite(num)) throw new InviteError('bp must contain finite numbers');
    return num;
  });
  if (bp.length === 0) return [...DEFAULT_BP];
  if (bp.length > 128) throw new InviteError('bp is limited to 128 entries');
  return bp;
}

export function buildInvite(input: { contentUrl: string; realm?: string; bp?: unknown }): InvitePayload {
  return {
    realm: (input.realm ?? INVITE_REALM).trim() || INVITE_REALM,
    script: input.contentUrl.trim(),
    bp: normaliseBp(input.bp),
  };
}

/** Pretty JSON exactly like the decrypted invite payload. */
export function serialiseInvite(payload: InvitePayload): string {
  return JSON.stringify(
    { realm: payload.realm, script: payload.script, bp: payload.bp },
    null,
    2,
  );
}

export function encodeInvite(payload: InvitePayload): string {
  return toBase64Url(encoder.encode(serialiseInvite(payload)));
}

/**
 * Accepts anything a user might paste: the pretty JSON itself, a base64 or
 * base64url blob, a percent-encoded document, or a deep link such as
 * `nullsbrawl://script?data=…` / `…/import?invite=…`.
 */
export function decodeInvite(input: string): InvitePayload {
  if (typeof input !== 'string') throw new InviteError('Invite is empty');
  let text = input.trim();
  if (!text) throw new InviteError('Invite is empty');

  // Deep links and share URLs: pull the payload out of the query string.
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  if (looksLikeUrl || text.includes('?invite=') || text.includes('&invite=')) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(text);
    } catch {
      parsed = null;
    }
    if (parsed) {
      const candidate =
        parsed.searchParams.get('invite') ??
        parsed.searchParams.get('data') ??
        parsed.searchParams.get('payload') ??
        parsed.searchParams.get('script');
      if (candidate) text = candidate;
      else if (parsed.protocol === 'nullsbrawl:' || parsed.protocol === 'brawlstars:') {
        // e.g. nullsbrawl://script/<base64>
        const tail = parsed.pathname.split('/').filter(Boolean).pop();
        if (tail) text = tail;
      }
    }
  }

  if (text.includes('%7B') || text.startsWith('%7b')) {
    try {
      text = decodeURIComponent(text);
    } catch {
      /* not percent-encoded */
    }
  }

  const parse = (candidate: string): InvitePayload | null => {
    try {
      const value = JSON.parse(candidate) as Partial<InvitePayload>;
      if (!value || typeof value !== 'object' || typeof value.script !== 'string') return null;
      return {
        realm: typeof value.realm === 'string' && value.realm.trim() ? value.realm.trim() : INVITE_REALM,
        script: value.script.trim(),
        bp: normaliseBp(value.bp),
      };
    } catch {
      return null;
    }
  };

  const direct = parse(text);
  if (direct) return validateInvite(direct);

  // base64 / base64url blob
  try {
    const decoded = decoder.decode(fromBase64Url(text.replace(/\s+/g, '')));
    const fromBlob = parse(decoded);
    if (fromBlob) return validateInvite(fromBlob);
  } catch {
    /* not base64 */
  }

  throw new InviteError('That does not look like an invite payload');
}

/** Structural + URL validation. */
export function validateInvite(payload: InvitePayload): InvitePayload {
  let url: URL;
  try {
    url = new URL(payload.script);
  } catch {
    throw new InviteError('The invite has no valid script URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new InviteError('The script URL must be http(s)');
  }
  if (!url.searchParams.get('token')) {
    throw new InviteError('The script URL has no content token');
  }
  return {
    realm: payload.realm || INVITE_REALM,
    script: url.toString(),
    bp: normaliseBp(payload.bp),
  };
}

/** `nullsbrawl://script?data=<base64url>` — what the game client opens. */
export function inviteDeepLink(payload: InvitePayload, scheme = 'nullsbrawl'): string {
  return `${scheme}://script?data=${encodeInvite(payload)}`;
}

/** Absolute link to the import screen of a site that can read invites. */
export function inviteImportUrl(payload: InvitePayload, origin: string): string {
  return `${origin.replace(/\/+$/, '')}/import?invite=${encodeInvite(payload)}`;
}

/** Best-effort script name from a content URL, for the import preview. */
export function guessScriptName(contentUrl: string, fallback = 'Imported script'): string {
  try {
    const url = new URL(contentUrl);
    const id = url.pathname.split('/').filter(Boolean);
    const guess = url.searchParams.get('name');
    if (guess) return guess.slice(0, 120);
    const segment = id.at(-2) ?? id.at(-1);
    return segment ? `${fallback} ${segment.slice(0, 8)}` : fallback;
  } catch {
    return fallback;
  }
}
