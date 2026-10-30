import type { Database, ReleaseRow, ScriptRow, SessionRow, UserRow } from '../types';
import { nowIso, uuidv4, uuidv7 } from './crypto';

/** Minimal storage surface: `localStorage` in the browser, a Map in tests. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const DB_KEY = 'nts.db.v1';

const EMPTY: Database = {
  version: 1,
  users: [],
  scripts: [],
  releases: [],
  shares: [],
  sessions: [],
  counters: { release_id: 15000 },
};

export const DEFAULT_TEMPLATE = `-- NB Scripting template
local done = false

function tick()
    if done then return end
    done = true
    log("hello from " .. server.gameMode)
end
`;

export class VirtualDatabase {
  private data: Database;

  constructor(private storage: StorageLike) {
    this.data = this.load();
  }

  private load(): Database {
    const raw = this.storage.getItem(DB_KEY);
    if (!raw) return structuredClone(EMPTY);
    try {
      const parsed = JSON.parse(raw) as Partial<Database>;
      return {
        ...structuredClone(EMPTY),
        ...parsed,
        users: parsed.users ?? [],
        scripts: parsed.scripts ?? [],
        releases: parsed.releases ?? [],
        shares: parsed.shares ?? [],
        sessions: parsed.sessions ?? [],
        counters: { release_id: parsed.counters?.release_id ?? 15000 },
      };
    } catch {
      return structuredClone(EMPTY);
    }
  }

  private persist(): void {
    this.storage.setItem(DB_KEY, JSON.stringify(this.data));
  }

  read(): Database {
    return this.data;
  }

  mutate<T>(fn: (data: Database) => T): T {
    const result = fn(this.data);
    this.persist();
    return result;
  }

  reset(): void {
    this.data = structuredClone(EMPTY);
    this.persist();
  }

  /* ---------------------------- users ---------------------------- */

  findUser(id: string): UserRow | null {
    return this.data.users.find((user) => user.user_id === id) ?? null;
  }

  findUserByUsername(username: string): UserRow | null {
    const needle = username.toLowerCase();
    return this.data.users.find((user) => user.username.toLowerCase() === needle) ?? null;
  }

  findUserByConnectSub(sub: string): UserRow | null {
    return this.data.users.find((user) => user.connect_sub === sub) ?? null;
  }

  createUser(input: {
    name: string;
    username: string;
    password_hash?: string | null;
    connect_sub?: string | null;
    email?: string | null;
  }): UserRow {
    return this.mutate((data) => {
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

  /* --------------------------- scripts --------------------------- */

  findScript(id: string): ScriptRow | null {
    return this.data.scripts.find((script) => script.script_id === id) ?? null;
  }

  createScript(input: {
    author_uuid: string;
    name: string;
    description?: string | null;
    code?: string;
    publish?: boolean;
  }): ScriptRow {
    return this.mutate((data) => {
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
          id: this.nextReleaseId(data),
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

  updateScript(
    id: string,
    patch: Partial<Pick<ScriptRow, 'name' | 'description' | 'code' | 'user_map_id' | 'user_map_internal_id'>>,
  ): ScriptRow | null {
    return this.mutate((data) => {
      const script = data.scripts.find((row) => row.script_id === id);
      if (!script) return null;
      if (patch.name !== undefined) script.name = patch.name;
      if (patch.description !== undefined) script.description = patch.description;
      if (patch.code !== undefined) script.code = patch.code;
      if (patch.user_map_id !== undefined) script.user_map_id = patch.user_map_id;
      if (patch.user_map_internal_id !== undefined) script.user_map_internal_id = patch.user_map_internal_id;
      script.updated_at = nowIso();
      return script;
    });
  }

  deleteScript(id: string): boolean {
    return this.mutate((data) => {
      const before = data.scripts.length;
      data.scripts = data.scripts.filter((script) => script.script_id !== id);
      data.releases = data.releases.filter((release) => release.script_id !== id);
      data.shares = data.shares.filter((share) => share.script_id !== id);
      return data.scripts.length !== before;
    });
  }

  publishScript(id: string): { script: ScriptRow; release: ReleaseRow } | null {
    return this.mutate((data) => {
      const script = data.scripts.find((row) => row.script_id === id);
      if (!script) return null;
      const ts = nowIso();
      script.published_at = script.published_at ?? ts;
      script.updated_at = ts;
      const release: ReleaseRow = {
        id: this.nextReleaseId(data),
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

  toggleFavorite(id: string, userId: string, favorite: boolean): ScriptRow | null {
    return this.mutate((data) => {
      const script = data.scripts.find((row) => row.script_id === id);
      if (!script) return null;
      const has = script.favorites.includes(userId);
      if (favorite && !has) script.favorites.push(userId);
      if (!favorite && has) script.favorites = script.favorites.filter((entry) => entry !== userId);
      return script;
    });
  }

  private nextReleaseId(data: Database): number {
    data.counters.release_id += 1;
    return data.counters.release_id;
  }

  /* -------------------------- sessions -------------------------- */

  createSession(userId: string, ttlSeconds = 60 * 60 * 24 * 30): SessionRow {
    return this.mutate((data) => {
      const session: SessionRow = {
        session_id: uuidv7(),
        user_id: userId,
        created_at: nowIso(),
        expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        user_agent: typeof navigator === 'undefined' ? null : navigator.userAgent,
        ip: null,
      };
      data.sessions = data.sessions.filter((row) => new Date(row.expires_at).getTime() > Date.now());
      data.sessions.push(session);
      return session;
    });
  }

  findSession(id: string): SessionRow | null {
    const session = this.data.sessions.find((row) => row.session_id === id);
    if (!session) return null;
    if (new Date(session.expires_at).getTime() <= Date.now()) return null;
    return session;
  }

  destroySession(id: string): void {
    this.mutate((data) => {
      data.sessions = data.sessions.filter((row) => row.session_id !== id);
    });
  }
}

function internalMapId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const pick = (length: number) =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(length)),
      (byte) => alphabet[byte % alphabet.length],
    ).join('');
  return `${pick(9)}:${pick(11)}`;
}
