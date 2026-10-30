/**
 * Transport used by every client component.
 *
 * - server build  → `fetch()` against the Next.js route handlers in `app/api`
 * - static build  → the in-browser `VirtualServer` (same paths, same bodies)
 *
 * The static build keeps the session id in `localStorage` and sends it as a
 * Bearer token, because GitHub Pages cannot set httpOnly cookies.
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

const SESSION_KEY = 'nts.session';
const SEED_KEY = 'nts.seeded';

let serverPromise: Promise<import('./virtual/server').VirtualServer> | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getSessionToken(): string | null {
  return storage()?.getItem(SESSION_KEY) ?? null;
}

export function setSessionToken(token: string | null): void {
  const store = storage();
  if (!store) return;
  if (token) store.setItem(SESSION_KEY, token);
  else store.removeItem(SESSION_KEY);
}

async function virtualServer() {
  if (!serverPromise) {
    serverPromise = (async () => {
      const { VirtualServer } = await import('./virtual/server');
      const { VirtualDatabase } = await import('./virtual/db');
      const store = storage();
      if (!store) throw new Error('This build needs localStorage');
      const database = new VirtualDatabase(store);
      const server = new VirtualServer(database);
      // First visit on GitHub Pages: populate the demo content so the site is alive.
      if (!store.getItem(SEED_KEY)) {
        await server.seed();
        store.setItem(SEED_KEY, '1');
      }
      return server;
    })();
  }
  return serverPromise;
}

export async function api<T = unknown>(path: string, init: ApiInit = {}): Promise<ApiResult<T>> {
  const method = init.method ?? 'GET';

  if (IS_STATIC) {
    const server = await virtualServer();
    const response = await server.handle(method, path, {
      body: init.body,
      token: getSessionToken(),
    });

    const data = response.body as { session_id?: string } | null;
    if (data && typeof data === 'object' && typeof data.session_id === 'string') {
      setSessionToken(data.session_id);
    }
    return { status: response.status, ok: response.status >= 200 && response.status < 300, data: response.body as T };
  }

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  return { status: response.status, ok: response.ok, data: data as T };
}

/** Ends the session in both transports. */
export async function endSession(): Promise<void> {
  await api('/api/auth/logout', { method: 'POST', body: {} });
  setSessionToken(null);
}

/** Static build only: wipes the local database (used by the settings screen). */
export async function resetLocalData(): Promise<void> {
  const store = storage();
  if (!store) return;
  store.removeItem('nts.db.v1');
  store.removeItem(SEED_KEY);
  setSessionToken(null);
  serverPromise = null;
}

export interface ApiResponseLike {
  ok: boolean;
  status: number;
  // deno-lint-ignore no-explicit-any
  json(): Promise<any>;
  text(): Promise<string>;
}

/**
 * Fetch-shaped helper so components can stay close to plain `fetch` while
 * transparently using the in-browser backend on GitHub Pages.
 */
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

  if (IS_STATIC) {
    const server = await virtualServer();
    const response = await server.handle(method, path, { body: parsedBody, token: getSessionToken() });
    const payload = response.body as { session_id?: string } | null;
    if (payload && typeof payload === 'object' && typeof payload.session_id === 'string') {
      setSessionToken(payload.session_id);
    }
    const text = payload === null ? '' : JSON.stringify(payload);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => (text ? JSON.parse(text) : ({} as unknown)),
      text: async () => text,
    };
  }

  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    body: init.body === undefined ? undefined : preStringified ? (init.body as string) : JSON.stringify(init.body),
    signal: init.signal,
  });

  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
    text: () => response.text(),
  };
}

function safeParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}
