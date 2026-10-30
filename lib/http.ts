import { NextResponse } from 'next/server';

export const NO_STORE = 'no-store, max-age=0';

export function json(data: unknown, init: ResponseInit = {}): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: {
      'Cache-Control': NO_STORE,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** 401/204 bodies are empty on the original API (`Content-Length: 0`). */
export function empty(status: number): NextResponse {
  return new NextResponse(null, { status, headers: { 'Cache-Control': NO_STORE } });
}

export function apiError(status: number, message: string, extra?: Record<string, unknown>): NextResponse {
  return json({ error: message, ...extra }, { status });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json') && request.headers.get('content-length') !== '0') {
    // be permissive: many clients forget the content-type header
  }
  const text = await request.text();
  if (!text) return {};
  if (text.length > 2 * 1024 * 1024) throw new HttpError(413, 'Payload too large');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'Expected a JSON object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Malformed JSON body');
  }
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handleError(error: unknown): NextResponse {
  if (error instanceof HttpError) return apiError(error.status, error.message);
  console.error('[api] unhandled error', error);
  return apiError(500, 'Internal Server Error');
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') ?? 'unknown';
}

export function stringParam(value: unknown, field: string, opts: {
  min?: number; max?: number; trim?: boolean; required?: boolean;
} = {}): string | undefined {
  if (value === undefined || value === null) {
    if (opts.required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  const out = opts.trim === false ? value : value.trim();
  if (opts.required && !out) throw new HttpError(400, `${field} is required`);
  if (opts.min !== undefined && out.length < opts.min) {
    throw new HttpError(400, `${field} must be at least ${opts.min} characters`);
  }
  if (opts.max !== undefined && out.length > opts.max) {
    throw new HttpError(400, `${field} must be at most ${opts.max} characters`);
  }
  return out;
}

export function intParam(value: unknown, field: string, opts: { min?: number; max?: number; fallback?: number } = {}): number | undefined {
  if (value === undefined || value === null || value === '') return opts.fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new HttpError(400, `${field} must be an integer`);
  }
  if (opts.min !== undefined && parsed < opts.min) throw new HttpError(400, `${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && parsed > opts.max) throw new HttpError(400, `${field} must be <= ${opts.max}`);
  return parsed;
}

/* ------------------------------------------------------------------ */
/* Naive fixed-window rate limiter (per process)                       */
/* ------------------------------------------------------------------ */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, 'Too many requests');
  }
}
