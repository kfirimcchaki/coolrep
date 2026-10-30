/** Shapes returned by the public REST API. Field names mirror the originals. */

export interface UserRow {
  user_id: string;
  name: string;
  username: string;
  /** scrypt hash, null for accounts that only use Null's Connect */
  password_hash: string | null;
  /** subject (`sub`) of the Null's Connect identity, if linked */
  connect_sub: string | null;
  email: string | null;
  created_at: string;
}

/** `GET /api/users/{uuid}` */
export interface PublicUser {
  user_id: string;
  name: string;
  username: string;
}

export interface ScriptRow {
  script_id: string;
  name: string;
  description: string | null;
  user_map_id: string;
  user_map_internal_id: string;
  author_uuid: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  code: string;
  /** user_ids that starred the script */
  favorites: string[];
}

/** `GET /api/scripts/{uuid}` */
export interface ScriptDetail {
  script_id: string;
  name: string;
  description: string | null;
  user_map_id: string;
  user_map_internal_id: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  author_uuid: string;
  author_name: string;
  is_favorite: boolean;
}

/** Element of `GET /api/scripts`, `/api/users/{uuid}/scripts`, `.../favorites` */
export interface ScriptListItem {
  script_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  author_uuid: string;
  author_name: string;
  is_favorite: boolean;
}

export interface ReleaseRow {
  id: number;
  script_id: string;
  description: string | null;
  code: string;
  created_at: string;
  /** user who published the release */
  author_uuid: string;
}

export interface ReleaseSummary {
  id: number;
  description: string | null;
  created_at: string;
}

export interface ShareRow {
  token: string;
  script_id: string;
  release_id: number;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  uses: number;
}

export interface SessionRow {
  session_id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

export interface Database {
  version: number;
  users: UserRow[];
  scripts: ScriptRow[];
  releases: ReleaseRow[];
  shares: ShareRow[];
  sessions: SessionRow[];
  counters: { release_id: number };
}
