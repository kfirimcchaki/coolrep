/**
 * Shared storage for the static build: a GitHub Gist as the database.
 *
 * GitHub Pages is static-only, so the in-browser backend is per-browser by
 * default. To break that limit *without* deploying anything, the same
 * `Database` document can live in a secret GitHub Gist that the user owns:
 *
 *   - reads/writes go through https://api.github.com (CORS-enabled, HTTPS)
 *   - the browser keeps its IndexedDB copy, so the app works offline and
 *     flushes to the gist when the network comes back
 *   - `?gist=<id>` on any machine loads the shared snapshot
 *
 * Everything here is opt-in: with no stored token the storage facade is a
 * transparent pass-through.
 */

import type { Database } from '../types';
import type { StorageLike } from './db';

export const GIST_CONFIG_KEY = 'nts.gist';
export const GIST_FILE_NAME = 'nt-scripting-db.json';
export const GIST_DB_KEY = 'nts.db.v1';

const API = 'https://api.github.com';

export interface GistConfig {
  /** Fine-grained/classic token with the `gist` scope. Never leaves the device. */
  token: string;
  /** Existing gist id, or null before the first push. */
  gistId: string | null;
}

export interface GistStatus {
  configured: boolean;
  gistId: string | null;
  lastPushAt: string | null;
  lastError: string | null;
}

export class GistError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GistError';
  }
}

/** A blank database document, used when a fresh browser links a gist. */
export function emptyDocument(): Database {
  return {
    version: 1,
    users: [],
    scripts: [],
    releases: [],
    shares: [],
    sessions: [],
    counters: { release_id: 15000 },
  };
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readGistConfig(): GistConfig | null {
  const raw = storage()?.getItem(GIST_CONFIG_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GistConfig>;
    if (typeof parsed.token !== 'string' || parsed.token.length < 10) return null;
    return { token: parsed.token, gistId: typeof parsed.gistId === 'string' ? parsed.gistId : null };
  } catch {
    return null;
  }
}

export function writeGistConfig(config: GistConfig | null): void {
  const store = storage();
  if (!store) return;
  if (!config) store.removeItem(GIST_CONFIG_KEY);
  else store.setItem(GIST_CONFIG_KEY, JSON.stringify(config));
}

export function gistShareUrl(gistId: string): string {
  const base = (typeof window !== 'undefined' && window.__NT_BASE__) || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${base}/settings?gist=${gistId}`;
}

/** A gist id can be pasted as a bare id or as a full gist URL. */
export function parseGistId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const fromUrl = trimmed.match(/gist\.github\.com\/(?:[^/]+\/)?([0-9a-f]{6,64})/i);
  if (fromUrl) return fromUrl[1];
  return /^[0-9a-f]{6,64}$/i.test(trimmed) ? trimmed : null;
}

/* ------------------------------------------------------------------ */
/* GitHub API                                                          */
/* ------------------------------------------------------------------ */

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    ...((rest.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...rest, headers });
  } catch {
    throw new GistError('GitHub is unreachable — the local copy is still saved', 0);
  }

  const text = await response.text();
  if (!response.ok) {
    let message = `GitHub responded ${response.status}`;
    try {
      const payload = JSON.parse(text) as { message?: string };
      if (payload?.message) message = payload.message;
    } catch {
      /* keep the status message */
    }
    if (response.status === 401) message = 'GitHub rejected the token (401) — check its `gist` scope';
    if (response.status === 403 && /rate limit/i.test(message)) {
      message = 'GitHub rate limit hit — the local copy is saved and will sync later';
    }
    throw new GistError(message, response.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface GistFile {
  filename?: string;
  content?: string;
  truncated?: boolean;
  raw_url?: string;
  size?: number;
}

interface GistPayload {
  id: string;
  html_url?: string;
  updated_at?: string;
  files?: Record<string, GistFile>;
}

function pickFile(payload: GistPayload): GistFile | null {
  const files = payload.files ?? {};
  if (files[GIST_FILE_NAME]) return files[GIST_FILE_NAME];
  const first = Object.values(files)[0];
  return first ?? null;
}

/** Reads the database document out of a gist (works for public gists, no token). */
export async function fetchGistDocument(gistId: string, token?: string): Promise<Database | null> {
  const payload = await request<GistPayload>(`/gists/${gistId}`, { token });
  const file = pickFile(payload);
  if (!file) return null;

  let content = !file.truncated ? file.content : undefined;
  if ((!content || file.truncated) && file.raw_url) {
    // Gists truncate inline content above ~1 MB; the raw URL is authoritative.
    const raw = await fetch(file.raw_url, file.raw_url.includes('gist.githubusercontent.com') ? { cache: 'no-store' } : undefined);
    if (!raw.ok) throw new GistError(`Could not read the gist file (${raw.status})`, raw.status);
    content = await raw.text();
  }
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as Partial<Database>;
    if (!parsed || !Array.isArray(parsed.scripts)) return null;
    return {
      version: parsed.version ?? 1,
      users: parsed.users ?? [],
      scripts: parsed.scripts,
      releases: parsed.releases ?? [],
      shares: parsed.shares ?? [],
      sessions: parsed.sessions ?? [],
      counters: { release_id: parsed.counters?.release_id ?? 15000 },
    };
  } catch {
    throw new GistError('The gist does not contain a valid NT Scripting database', 422);
  }
}

/** Creates or updates the gist and returns the config to persist. */
export async function pushGistDocument(config: GistConfig, data: Database): Promise<GistConfig> {
  const body = JSON.stringify({
    description: 'NT Scripting clone — shared database',
    public: false,
    files: { [GIST_FILE_NAME]: { content: JSON.stringify(data) } },
  });

  if (!config.gistId) {
    const created = await request<GistPayload>('/gists', { method: 'POST', token: config.token, body });
    return { token: config.token, gistId: created.id };
  }

  try {
    await request<GistPayload>(`/gists/${config.gistId}`, {
      method: 'PATCH',
      token: config.token,
      body,
    });
    return config;
  } catch (error) {
    // A wrong/stale id should not brick sync: create a fresh gist instead.
    if (error instanceof GistError && (error.status === 404 || error.status === 422)) {
      const created = await request<GistPayload>('/gists', { method: 'POST', token: config.token, body });
      return { token: config.token, gistId: created.id };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

let lastPushAt: string | null = null;
let lastError: string | null = null;
let lastPushedBody: string | null = null;

export function gistStatus(): GistStatus {
  const config = readGistConfig();
  return {
    configured: Boolean(config?.gistId),
    gistId: config?.gistId ?? null,
    lastPushAt,
    lastError,
  };
}

/* ------------------------------------------------------------------ */
/* Storage facade                                                      */
/* ------------------------------------------------------------------ */

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: never[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  }) as T;
}

let pendingPush: (() => void) | null = null;

/** Immediately flushes any debounced write (used before unload). */
export function flushGistSync(): void {
  pendingPush?.();
}

/**
 * Wraps a storage facade so every write to the database key is mirrored to the
 * configured gist (debounced, fire-and-forget, errors surfaced via gistStatus).
 */
export function createGistStorage(base: StorageLike): StorageLike {
  const config = readGistConfig();
  if (!config) return base;

  let current: GistConfig = config;

  const push = async (raw: string) => {
    if (raw === lastPushedBody) return;
    try {
      current = await pushGistDocument(current, JSON.parse(raw) as Database);
      writeGistConfig(current);
      lastPushedBody = raw;
      lastPushAt = new Date().toISOString();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  };

  let latest: string | null = null;
  const flush = () => {
    if (latest === null) return;
    const raw = latest;
    latest = null;
    void push(raw);
  };
  pendingPush = flush;
  const scheduled = debounce(flush, 1200);

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('online', flush);
  }

  return {
    getItem: (key) => base.getItem(key),
    setItem(key, value) {
      base.setItem(key, value);
      if (key === GIST_DB_KEY) {
        latest = value;
        scheduled();
      }
    },
    removeItem(key) {
      base.removeItem(key);
      if (key === GIST_DB_KEY) {
        latest = null;
      }
    },
  };
}

/**
 * Boot-time hydration: pulls the shared snapshot into local storage so the
 * in-browser backend starts from it. Handles both a configured gist and a
 * `?gist=<id>` link (read-only when there is no token).
 */
export async function hydrateFromSharedStore(
  store: StorageLike,
  query?: URLSearchParams | null,
): Promise<{ source: 'gist' | 'link' | null; error: string | null }> {
  const fromQuery = parseGistId(query?.get('gist') ?? null);
  const config = readGistConfig();
  const target = config?.gistId ?? fromQuery;
  if (!target) return { source: null, error: null };

  // An explicit link wins for this visit and is remembered when a token exists.
  if (fromQuery && config && fromQuery !== config.gistId) {
    writeGistConfig({ ...config, gistId: fromQuery });
  }

  try {
    const data = await fetchGistDocument(target, fromQuery === config?.gistId ? config?.token : undefined);
    if (!data) return { source: null, error: null };
    const raw = JSON.stringify(data);
    store.setItem(GIST_DB_KEY, raw);
    lastPushedBody = raw;
    return { source: fromQuery ? 'link' : 'gist', error: null };
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    return { source: null, error: lastError };
  }
}
