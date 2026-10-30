import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nowIso, uuidv4, uuidv7 } from './ids';
import type {
  Database,
  PublicUser,
  ReleaseRow,
  ReleaseSummary,
  ScriptDetail,
  ScriptListItem,
  ScriptRow,
  SessionRow,
  UserRow,
} from './types';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), '.data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY_DB: Database = {
  version: 1,
  users: [],
  scripts: [],
  releases: [],
  shares: [],
  sessions: [],
  counters: { release_id: 15000 },
};

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

let cache: Database | null = null;
let loading: Promise<Database> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

async function readFromDisk(): Promise<Database> {
  try {
    const raw = await fs.readFile(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Database>;
    return {
      ...structuredClone(EMPTY_DB),
      ...parsed,
      users: parsed.users ?? [],
      scripts: parsed.scripts ?? [],
      releases: parsed.releases ?? [],
      shares: parsed.shares ?? [],
      sessions: parsed.sessions ?? [],
      counters: { release_id: parsed.counters?.release_id ?? 15000 },
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return structuredClone(EMPTY_DB);
  }
}

export async function db(): Promise<Database> {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      const loaded = await readFromDisk();
      cache = loaded;
      return loaded;
    })();
  }
  return loading;
}

/**
 * Persist the in-memory database with an atomic rename. Writes are serialised
 * through a promise chain so concurrent requests can never interleave.
 */
export async function flush(): Promise<void> {
  const snapshot = cache;
  if (!snapshot) return;
  const payload = JSON.stringify(snapshot, null, 0);
  writeChain = writeChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.${process.pid}.tmp`;
    await fs.writeFile(tmp, payload, 'utf8');
    await fs.rename(tmp, DB_FILE);
  });
  await writeChain;
}

/** Mutate + persist in one step. */
export async function transact<T>(fn: (data: Database) => T | Promise<T>): Promise<T> {
  const data = await db();
  const result = await fn(data);
  await flush();
  return result;
}

/** Test/seed helper. */
export async function replaceDatabase(next: Database): Promise<void> {
  cache = next;
  await flush();
}

export async function resetDatabase(): Promise<void> {
  cache = structuredClone(EMPTY_DB);
  await flush();
}

/* ------------------------------------------------------------------ */
/* Projections                                                         */
/* ------------------------------------------------------------------ */

export function toPublicUser(user: UserRow): PublicUser {
  return { user_id: user.user_id, name: user.name, username: user.username };
}

function authorName(data: Database, authorUuid: string): string {
  return data.users.find((u) => u.user_id === authorUuid)?.name ?? 'Unknown';
}

export function toScriptDetail(
  data: Database,
  script: ScriptRow,
  viewerId: string | null,
): ScriptDetail {
  return {
    script_id: script.script_id,
    name: script.name,
    description: script.description,
    user_map_id: script.user_map_id,
    user_map_internal_id: script.user_map_internal_id,
    created_at: script.created_at,
    updated_at: script.updated_at,
    published_at: script.published_at,
    author_uuid: script.author_uuid,
    author_name: authorName(data, script.author_uuid),
    is_favorite: viewerId ? script.favorites.includes(viewerId) : false,
  };
}

export function toScriptListItem(
  data: Database,
  script: ScriptRow,
  viewerId: string | null,
): ScriptListItem {
  return {
    script_id: script.script_id,
    name: script.name,
    description: script.description,
    created_at: script.created_at,
    updated_at: script.updated_at,
    published_at: script.published_at,
    author_uuid: script.author_uuid,
    author_name: authorName(data, script.author_uuid),
    is_favorite: viewerId ? script.favorites.includes(viewerId) : false,
  };
}

export function toReleaseSummary(release: ReleaseRow): ReleaseSummary {
  return {
    id: release.id,
    description: release.description,
    created_at: release.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function findUserById(id: string): Promise<UserRow | null> {
  const data = await db();
  return data.users.find((u) => u.user_id === id) ?? null;
}

export async function findUserByUsername(username: string): Promise<UserRow | null> {
  const data = await db();
  const needle = username.toLowerCase();
  return data.users.find((u) => u.username.toLowerCase() === needle) ?? null;
}

export async function findUserByConnectSub(sub: string): Promise<UserRow | null> {
  const data = await db();
  return data.users.find((u) => u.connect_sub === sub) ?? null;
}

export async function findScript(id: string): Promise<ScriptRow | null> {
  const data = await db();
  return data.scripts.find((s) => s.script_id === id) ?? null;
}

/** Scripts visible on public surfaces: everything that has been published. */
export function visibleScripts(data: Database): ScriptRow[] {
  return data.scripts.filter((s) => s.published_at !== null);
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  search?: string;
  author?: string;
  sort?: 'recent' | 'updated' | 'name';
}

export async function listPublishedScripts(
  viewerId: string | null,
  options: ListOptions = {},
): Promise<{ scripts: ScriptListItem[]; total: number }> {
  const data = await db();
  const limit = Math.min(Math.max(options.limit ?? 24, 1), 100);
  const offset = Math.max(options.offset ?? 0, 0);
  const search = options.search?.trim().toLowerCase();

  let rows = visibleScripts(data);
  if (options.author) rows = rows.filter((s) => s.author_uuid === options.author);
  if (search) {
    rows = rows.filter(
      (s) =>
        s.name.toLowerCase().includes(search) ||
        (s.description ?? '').toLowerCase().includes(search) ||
        authorName(data, s.author_uuid).toLowerCase().includes(search),
    );
  }

  const sort = options.sort ?? 'recent';
  rows = [...rows].sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name);
    if (sort === 'updated') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
    return (b.published_at ?? '').localeCompare(a.published_at ?? '');
  });

  return {
    scripts: rows.slice(offset, offset + limit).map((s) => toScriptListItem(data, s, viewerId)),
    total: rows.length,
  };
}

export async function listUserScripts(
  userId: string,
  viewerId: string | null,
  options: ListOptions = {},
): Promise<{ scripts: ScriptListItem[]; total: number }> {
  const data = await db();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);
  const isOwner = viewerId === userId;

  const rows = data.scripts
    .filter((s) => s.author_uuid === userId)
    // the owner also sees unpublished drafts, everybody else only releases
    .filter((s) => isOwner || s.published_at !== null)
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  return {
    scripts: rows.slice(offset, offset + limit).map((s) => toScriptListItem(data, s, viewerId)),
    total: rows.length,
  };
}

export async function listUserFavorites(
  userId: string,
  viewerId: string | null,
): Promise<{ scripts: ScriptListItem[]; total: number }> {
  const data = await db();
  const rows = data.scripts
    .filter((s) => s.favorites.includes(userId) && s.published_at !== null)
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));

  return {
    scripts: rows.map((s) => toScriptListItem(data, s, viewerId)),
    total: rows.length,
  };
}

export async function listReleases(scriptId: string): Promise<ReleaseSummary[]> {
  const data = await db();
  return data.releases
    .filter((r) => r.script_id === scriptId)
    .sort((a, b) => b.id - a.id)
    .map(toReleaseSummary);
}

export async function findRelease(id: number): Promise<ReleaseRow | null> {
  const data = await db();
  return data.releases.find((r) => r.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

export function nextReleaseId(data: Database): number {
  data.counters.release_id += 1;
  return data.counters.release_id;
}

export async function createUser(input: {
  name: string;
  username: string;
  password_hash?: string | null;
  connect_sub?: string | null;
  email?: string | null;
}): Promise<UserRow> {
  return transact((data) => {
    const user: UserRow = {
      user_id: uuidv7(),
      name: input.name,
      username: input.username,
      password_hash: input.password_hash ?? null,
      connect_sub: input.connect_sub ?? null,
      email: input.email ?? null,
      created_at: nowIso(),
    };
    data.users.push(user);
    return user;
  });
}

export async function createScript(input: {
  author_uuid: string;
  name: string;
  description?: string | null;
  code?: string;
  publish?: boolean;
}): Promise<ScriptRow> {
  return transact((data) => {
    const ts = nowIso();
    const script: ScriptRow = {
      script_id: uuidv7(),
      name: input.name,
      description: input.description ?? null,
      user_map_id: uuidv4(),
      user_map_internal_id: internalMapId(),
      author_uuid: input.author_uuid,
      created_at: ts,
      updated_at: ts,
      published_at: input.publish ? ts : null,
      code: input.code ?? DEFAULT_TEMPLATE,
      favorites: [],
    };
    data.scripts.push(script);

    if (input.publish) {
      data.releases.push({
        id: nextReleaseId(data),
        script_id: script.script_id,
        description: null,
        code: script.code,
        created_at: ts,
        author_uuid: script.author_uuid,
      });
    }
    return script;
  });
}

export async function updateScript(
  scriptId: string,
  patch: Partial<Pick<ScriptRow, 'name' | 'description' | 'code' | 'user_map_id' | 'user_map_internal_id'>>,
): Promise<ScriptRow | null> {
  return transact((data) => {
    const script = data.scripts.find((s) => s.script_id === scriptId);
    if (!script) return null;
    if (patch.name !== undefined) script.name = patch.name;
    if (patch.description !== undefined) script.description = patch.description;
    if (patch.code !== undefined) script.code = patch.code;
    if (patch.user_map_id !== undefined) script.user_map_id = patch.user_map_id;
    if (patch.user_map_internal_id !== undefined) {
      script.user_map_internal_id = patch.user_map_internal_id;
    }
    script.updated_at = nowIso();
    return script;
  });
}

export async function deleteScript(scriptId: string): Promise<boolean> {
  return transact((data) => {
    const before = data.scripts.length;
    data.scripts = data.scripts.filter((s) => s.script_id !== scriptId);
    data.releases = data.releases.filter((r) => r.script_id !== scriptId);
    data.shares = data.shares.filter((s) => s.script_id !== scriptId);
    return data.scripts.length !== before;
  });
}

export async function publishScript(scriptId: string): Promise<{ script: ScriptRow; release: ReleaseRow } | null> {
  return transact((data) => {
    const script = data.scripts.find((s) => s.script_id === scriptId);
    if (!script) return null;
    const ts = nowIso();
    script.published_at = script.published_at ?? ts;
    script.updated_at = ts;
    const release: ReleaseRow = {
      id: nextReleaseId(data),
      script_id: script.script_id,
      description: null,
      code: script.code,
      created_at: ts,
      author_uuid: script.author_uuid,
    };
    data.releases.push(release);
    return { script, release };
  });
}

export async function toggleFavorite(
  scriptId: string,
  userId: string,
  favorite: boolean,
): Promise<ScriptRow | null> {
  return transact((data) => {
    const script = data.scripts.find((s) => s.script_id === scriptId);
    if (!script) return null;
    const has = script.favorites.includes(userId);
    if (favorite && !has) script.favorites.push(userId);
    if (!favorite && has) script.favorites = script.favorites.filter((id) => id !== userId);
    return script;
  });
}

/* Sessions ---------------------------------------------------------- */

export async function createSession(input: {
  user_id: string;
  ttlSeconds: number;
  user_agent?: string | null;
  ip?: string | null;
}): Promise<SessionRow> {
  return transact((data) => {
    const created = new Date();
    const session: SessionRow = {
      session_id: uuidv7(),
      user_id: input.user_id,
      created_at: nowIso(),
      expires_at: new Date(created.getTime() + input.ttlSeconds * 1000).toISOString(),
      user_agent: input.user_agent ?? null,
      ip: input.ip ?? null,
    };
    data.sessions.push(session);
    // opportunistically drop expired sessions
    const now = Date.now();
    data.sessions = data.sessions.filter((s) => new Date(s.expires_at).getTime() > now);
    return session;
  });
}

export async function findSession(sessionId: string): Promise<SessionRow | null> {
  const data = await db();
  const session = data.sessions.find((s) => s.session_id === sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await transact((d) => {
      d.sessions = d.sessions.filter((s) => s.session_id !== sessionId);
    });
    return null;
  }
  return session;
}

export async function destroySession(sessionId: string): Promise<void> {
  await transact((data) => {
    data.sessions = data.sessions.filter((s) => s.session_id !== sessionId);
  });
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** 7-character map code in the original's style (`CRPJR2C0U:9YGC8UV9RCJ`). */
function internalMapId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const pick = (n: number) =>
    Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  return `${pick(9)}:${pick(11)}`;
}

export const DEFAULT_TEMPLATE = `-- NB Scripting template
local done = false

function tick()
    if done then return end
    done = true
    log("hello from " .. server.gameMode)
end
`;
