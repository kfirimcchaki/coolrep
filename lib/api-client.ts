/**
 * Transport used by every client component.
 *
 * Three wiring options, picked automatically:
 *
 *  1. server build                     → `fetch()` against `app/api/**` (same origin, cookies)
 *  2. static build, no backend config  → the in-browser `VirtualServer` (localStorage/IndexedDB)
 *  3. static build + a backend URL     → that server's `/api/*` over HTTPS with Bearer
 *                                        sessions, so GitHub Pages can share one database
 *                                        across devices and users.
 */

export const IS_STATIC = process.env.NEXT_PUBLIC_STATIC_MODE === '1';

export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  data: T;
}

export interface ApiInit {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface ApiResponseLike {
  ok: boolean;
  status: number;
  // deno-lint-ignore no-explicit-any
  json(): Promise<any>;
  text(): Promise<string>;
}

const SESSION_KEY = 'nts.session';
const API_BASE_KEY = 'nts.apiBase';
const SEED_KEY = 'nts.seeded';
const LOCAL_ONLY_KEY = 'nts.backendOff';

/* ------------------------------------------------------------------ */
/* Backend selection                                                   */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

declare global {
  interface Window {
    __NT_API__?: string;
    __NT_BASE__?: string;
  }
}

function normaliseBase(value: string | null | undefined): string {
  if (!value) return '';
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed;
}

/**
 * The API origin used by the static build. Empty string = the in-browser
 * backend. Priority: `?api=` URL parameter → window.__NT_API__ → stored value.
 */
export function resolveApiBase(): string {
  if (typeof window === 'undefined') return '';
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('api');
    if (fromQuery) {
      const normalised = normaliseBase(fromQuery);
      if (normalised && normalised !== getStoredApiBase()) setStoredApiBase(normalised);
      if (normalised) return normalised;
    }
  } catch {
    /* ignore */
  }
  if (window.__NT_API__) return normaliseBase(window.__NT_API__);
  const stored = getStoredApiBase();
  if (stored) return stored;
  // A build can ship a default backend (`NT_API=… npm run build:static`), and the
  // "use this browser" switch opts out of it for good.
  if (storage()?.getItem(LOCAL_ONLY_KEY) === '1') return '';
  return normaliseBase(process.env.NT_API);
}

export function getStoredApiBase(): string {
  return normaliseBase(storage()?.getItem(API_BASE_KEY));
}

export function setStoredApiBase(base: string): void {
  const store = storage();
  if (!store) return;
  const normalised = normaliseBase(base);
  if (normalised) {
    store.setItem(API_BASE_KEY, normalised);
    store.removeItem(LOCAL_ONLY_KEY);
  } else {
    store.removeItem(API_BASE_KEY);
  }
}

/** Drops the backend override and forgets the remote session. */
export function useLocalBackend(): void {
  setStoredApiBase('');
  // Remember the choice, so a build-time default API does not come back.
  storage()?.setItem(LOCAL_ONLY_KEY, '1');
  setSessionToken(null);
}

export function backendMode(): 'local' | 'remote' {
  const base = resolveApiBase();
  if (!base) return 'local';
  return 'remote';
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export function getSessionToken(): string | null {
  return storage()?.getItem(SESSION_KEY) ?? null;
}

export function setSessionToken(token: string | null): void {
  const store = storage();
  if (!store) return;
  if (token) store.setItem(SESSION_KEY, token);
  else store.removeItem(SESSION_KEY);
}

/* ------------------------------------------------------------------ */
/* Local (in-browser) backend                                          */
/* ------------------------------------------------------------------ */

let serverPromise: Promise<import('./virtual/server').VirtualServer> | null = null;

async function virtualServer() {
  if (!serverPromise) {
    serverPromise = (async () => {
      const { VirtualServer } = await import('./virtual/server');
      const { VirtualDatabase, createBrowserStorage } = await import('./virtual/db');
      const { createGistStorage, hydrateFromSharedStore } = await import('./virtual/gist-sync');

      const plain = await createBrowserStorage();
      let query: URLSearchParams | null = null;
      try {
        query = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
      } catch {
        query = null;
      }

      // A gist (configured token or `?gist=<id>` link) hydrates the local copy
      // before anything is rendered, so the site starts from the shared data.
      const hydration = await hydrateFromSharedStore(plain, query);
      if (hydration.source) plain.setItem(SEED_KEY, '1');

      const store = createGistStorage(plain);
      const database = new VirtualDatabase(store);
      const server = new VirtualServer(database);
      // First visit: populate the demo content so the site is never empty.
      if (!store.getItem(SEED_KEY)) {
        await server.seed();
        store.setItem(SEED_KEY, '1');
      }
      return server;
    })();
  }
  return serverPromise;
}

/** Static build only: wipes the local database. */
export async function resetLocalData(): Promise<void> {
  const { destroyBrowserStorage } = await import('./virtual/db');
  await destroyBrowserStorage();
  serverPromise = null;
  setSessionToken(null);
}

/** Static build only: JSON backup of everything the browser holds. */
export async function exportLocalData(): Promise<string> {
  const { readBrowserData } = await import('./virtual/db');
  return JSON.stringify(
    { exported_at: new Date().toISOString(), kind: 'nt-scripting-backup', data: await readBrowserData() },
    null,
    2,
  );
}

/** Static build only: restores a backup produced by `exportLocalData`. */
export async function importLocalData(json: string): Promise<{ scripts: number; users: number }> {
  const { writeBrowserData } = await import('./virtual/db');
  const parsed = JSON.parse(json) as { data?: unknown; scripts?: unknown };
  const payload = (parsed.data ?? parsed) as Record<string, unknown>;
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { scripts?: unknown[] }).scripts)) {
    throw new Error('Not a valid NT Scripting backup');
  }
  await writeBrowserData(payload);
  serverPromise = null;
  const scripts = (payload.scripts as unknown[]).length;
  const users = Array.isArray(payload.users) ? (payload.users as unknown[]).length : 0;
  return { scripts, users };
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

function captureSession(payload: unknown): void {
  if (payload && typeof payload === 'object' && typeof (payload as { session_id?: unknown }).session_id === 'string') {
    setSessionToken((payload as { session_id: string }).session_id);
  }
}

function parse(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function apiFetch(
  path: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    credentials?: string;
  } = {},
): Promise<ApiResponseLike> {
  const method = (init.method ?? 'GET').toUpperCase();
  // Accept both `body: {...}` and `body: JSON.stringify({...})`.
  const preStringified = typeof init.body === 'string';
  const parsedBody = preStringified ? safeParse(init.body as string) : init.body;

  const base = IS_STATIC ? resolveApiBase() : '';

  /* ---------- local in-browser backend ---------- */
  if (IS_STATIC && !base) {
    const server = await virtualServer();
    const response = await server.handle(method, path, { body: parsedBody, token: getSessionToken() });
    captureSession(response.body);
    const text =
      response.text ?? (response.body === null ? '' : JSON.stringify(response.body));
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => (text ? JSON.parse(text) : ({} as unknown)),
      text: async () => text,
    };
  }

  /* ---------- any HTTP backend ---------- */
  const token = IS_STATIC ? getSessionToken() : null;
  const headers: Record<string, string> = {
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...init.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${base}${path}`, {
    method,
    credentials: token || IS_STATIC ? 'omit' : 'same-origin',
    headers,
    body: init.body === undefined ? undefined : preStringified ? (init.body as string) : JSON.stringify(init.body),
    signal: init.signal,
  });

  const text = await response.text();
  const payload = parse(text);
  if (IS_STATIC) captureSession(payload);

  return {
    ok: response.ok,
    status: response.status,
    json: async () => (payload ?? ({} as unknown)),
    text: async () => text,
  };
}

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const response = await apiFetch(path, init);
  const data = (await response.json()) as T;
  return { status: response.status, ok: response.ok, data };
}

/** Ends the session in every transport. */
export async function endSession(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST', body: {} });
  } catch {
    /* offline: still drop the local token */
  }
  setSessionToken(null);
}

/** Health probe for the configured backend (used by the settings screen). */
export async function probeBackend(base?: string): Promise<{ ok: boolean; status: number; version?: number; scripts?: number }> {
  const target = base === undefined ? resolveApiBase() : normaliseBase(base);
  try {
    if (!target && IS_STATIC) {
      const server = await virtualServer();
      const response = await server.handle('GET', '/api/health', {});
      const body = response.body as { version?: number; counts?: { scripts?: number } } | null;
      return { ok: response.status === 200, status: response.status, version: body?.version, scripts: body?.counts?.scripts };
    }
    if (!target) {
      const response = await fetch('/api/health', { credentials: 'same-origin' });
      const body = (await response.json().catch(() => null)) as { version?: number; counts?: { scripts?: number } } | null;
      return { ok: response.ok, status: response.status, version: body?.version, scripts: body?.counts?.scripts };
    }
    const response = await fetch(`${target}/api/health`, { credentials: 'omit' });
    const body = (await response.json().catch(() => null)) as { version?: number; counts?: { scripts?: number } } | null;
    return { ok: response.ok, status: response.status, version: body?.version, scripts: body?.counts?.scripts };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function safeParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
