import { randomBytes, randomUUID } from 'node:crypto';

/**
 * The original platform mints script / user identifiers as UUIDv7 values
 * (e.g. `01a18307-1527-7454-9557-e96cac0d2448`), which are time-ordered and
 * therefore naturally sortable by creation time. We reproduce that exactly.
 */
export function uuidv7(): string {
  const bytes = randomBytes(16);
  const ms = BigInt(Date.now());

  // 48-bit big-endian millisecond timestamp
  bytes[0] = Number((ms >> 40n) & 0xffn);
  bytes[1] = Number((ms >> 32n) & 0xffn);
  bytes[2] = Number((ms >> 24n) & 0xffn);
  bytes[3] = Number((ms >> 16n) & 0xffn);
  bytes[4] = Number((ms >> 8n) & 0xffn);
  bytes[5] = Number(ms & 0xffn);

  // version 7
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  // RFC 4122 variant
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function uuidv4(): string {
  return randomUUID();
}

/** URL-safe opaque token (share links, session ids, OAuth state). */
export function opaqueToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Fixed 6-digit microseconds, so serialised timestamps look identical to the
 * originals: `2026-10-28T15:00:41.895585Z`.
 */
export function nowIso(): string {
  const now = new Date();
  const base = now.toISOString(); // 2026-10-30T12:05:50.203Z
  const [head, rest] = base.split('.');
  const millis = (rest ?? '000Z').slice(0, 3).padEnd(3, '0');
  const micros = String(Math.floor(Number(process.hrtime.bigint() % 1000n))).padStart(3, '0');
  return `${head}.${millis}${micros}Z`;
}

/** Normalises anything date-like to the microsecond ISO shape used by the API. */
export function toApiTime(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const base = date.toISOString();
  return base.replace(/\.(\d{3})Z$/, '.$1000Z');
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
