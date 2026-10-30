import type {
  Database,
  PublicUser,
  ReleaseRow,
  ScriptListItem,
  ScriptRow,
  UserRow,
} from '../types';
import { claimsForEmail, hashPassword, isUuid, nowIso, opaqueToken, signIdToken, uuidv7, verifyIdToken, verifyPassword } from './crypto';
import { VirtualDatabase } from './db';
import {
  buildInvite,
  DEFAULT_INVITE_TTL_SECONDS,
  encodeInvite,
  InviteError,
  inviteDeepLink,
  inviteImportUrl,
  serialiseInvite,
  signContentToken,
  verifyContentToken,
} from '../invite';
import { fetchScriptContent, ImportFetchError } from '../import-fetch';

/**
 * A complete, in-browser implementation of the platform REST API.
 *
 * It answers the same paths with the same status codes, bodies and error
 * messages as the Next.js route handlers (which are the ones exercised by
 * `scripts/smoke.mjs`), so the static GitHub Pages build behaves like the
 * server build — the only difference is the transport: instead of an httpOnly
 * cookie the SPA sends the session id in an `Authorization: Bearer` header.
 */

export interface VirtualResponse {
  status: number;
  body: unknown;
  /** Raw body for endpoints that answer text (the invite content URL). */
  text?: string;
  contentType?: string;
}

export interface VirtualRequestInit {
  body?: unknown;
  token?: string | null;
  /** Absolute origin used when minting invite URLs (defaults to location.origin). */
  origin?: string;
}

class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = { error: message }) {
    super(message);
  }
}

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

function str(value: unknown, field: string, opts: { required?: boolean; min?: number; max?: number; trim?: boolean } = {}): string | undefined {
  if (value === undefined || value === null) {
    if (opts.required) throw new ApiError(400, `${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ApiError(400, `${field} must be a string`);
  const out = opts.trim === false ? value : value.trim();
  if (opts.required && !out) throw new ApiError(400, `${field} is required`);
  if (opts.min !== undefined && out.length < opts.min) throw new ApiError(400, `${field} must be at least ${opts.min} characters`);
  if (opts.max !== undefined && out.length > opts.max) throw new ApiError(400, `${field} must be at most ${opts.max} characters`);
  return out;
}

function int(value: unknown, field: string, opts: { min?: number; max?: number; fallback?: number } = {}): number | undefined {
  if (value === undefined || value === null || value === '') return opts.fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) throw new ApiError(400, `${field} must be an integer`);
  if (opts.min !== undefined && parsed < opts.min) throw new ApiError(400, `${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && parsed > opts.max) throw new ApiError(400, `${field} must be <= ${opts.max}`);
  return parsed;
}

function authorName(data: Database, authorUuid: string): string {
  return data.users.find((user) => user.user_id === authorUuid)?.name ?? 'Unknown';
}

function toPublicUser(user: UserRow): PublicUser {
  return { user_id: user.user_id, name: user.name, username: user.username };
}

function toDetail(data: Database, script: ScriptRow, viewerId: string | null) {
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

function toListItem(data: Database, script: ScriptRow, viewerId: string | null): ScriptListItem {
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

function toReleaseSummary(release: ReleaseRow) {
  return { id: release.id, description: release.description, created_at: release.created_at };
}

function canView(script: ScriptRow, viewerId: string | null): boolean {
  return script.published_at !== null || script.author_uuid === viewerId;
}

function requestOrigin(init: VirtualRequestInit): string {
  if (init.origin) return init.origin.replace(/\/+$/, '');
  if (typeof location === 'undefined') return '';
  return `${location.origin}${basePath()}`;
}

export class VirtualServer {
  constructor(private db: VirtualDatabase) {}

  private viewer(token: string | null | undefined): UserRow | null {
    if (!token) return null;
    const session = this.db.findSession(token);
    if (!session) return null;
    return this.db.findUser(session.user_id);
  }

  private requireUser(token: string | null | undefined): UserRow {
    const user = this.viewer(token);
    if (!user) throw new ApiError(401, 'Unauthorized');
    return user;
  }

  async handle(method: string, rawPath: string, init: VirtualRequestInit = {}): Promise<VirtualResponse> {
    try {
      const result = await this.route(method.toUpperCase(), rawPath, init);
      return result;
    } catch (error) {
      if (error instanceof ApiError) {
        return { status: error.status, body: error.body };
      }
      console.error('[virtual api]', error);
      return { status: 500, body: { error: 'Internal Server Error' } };
    }
  }

  private async route(method: string, rawPath: string, init: VirtualRequestInit): Promise<VirtualResponse> {
    const url = new URL(rawPath, 'http://virtual.local');
    const segments = url.pathname.split('/').filter(Boolean); // ['api', ...]
    if (segments[0] !== 'api') throw new ApiError(404, 'Not found');
    const rest = segments.slice(1);
    const q = url.searchParams;
    const token = init.token;
    const body = (init.body ?? {}) as Record<string, unknown>;

    /* ------------------------------ health ------------------------------ */
    if (rest[0] === 'health' && rest.length === 1 && method === 'GET') {
      const data = this.db.read();
      return {
        status: 200,
        body: {
          status: 'ok',
          time: nowIso(),
          version: 1,
          counts: {
            users: data.users.length,
            scripts: data.scripts.length,
            releases: data.releases.length,
            shares: data.shares.length,
          },
        },
      };
    }

    /* ------------------------------- auth ------------------------------- */
    if (rest[0] === 'auth') {
      const action = rest[1];

      if (action === 'session' && method === 'GET') {
        const user = this.viewer(token);
        return { status: 200, body: { user: user ? toPublicUser(user) : null } };
      }

      if (action === 'register' && method === 'POST') {
        const name = str(body.name, 'name', { required: true, min: 1, max: 64 })!;
        const usernameRaw = str(body.username, 'username', { required: true, min: 3, max: 24 })!;
        const password = str(body.password, 'password', { required: true, min: 8, max: 128, trim: false })!;
        const username = usernameRaw.toLowerCase();
        if (!USERNAME_RE.test(username)) {
          throw new ApiError(400, 'Username may only contain a-z, 0-9 and _ (3-24 characters)');
        }
        if (this.db.findUserByUsername(username)) throw new ApiError(409, 'Username already taken');
        const hash = await hashPassword(password);
        const user = this.db.createUser({ name, username, password_hash: hash });
        const session = this.db.createSession(user.user_id);
        return { status: 201, body: { user: toPublicUser(user), session_id: session.session_id } };
      }

      if (action === 'login' && method === 'POST') {
        const username = str(body.username, 'username', { required: true, max: 64 })!.toLowerCase();
        const password = str(body.password, 'password', { required: true, max: 128, trim: false })!;
        const user = this.db.findUserByUsername(username);
        if (!user || !(await verifyPassword(password, user.password_hash))) {
          throw new ApiError(401, 'Invalid username or password');
        }
        const session = this.db.createSession(user.user_id);
        return { status: 200, body: { user: toPublicUser(user), session_id: session.session_id } };
      }

      if (action === 'logout' && method === 'POST') {
        if (token) this.db.destroySession(token);
        return { status: 200, body: { ok: true } };
      }

      if (action === 'password') {
        const user = this.requireUser(token);
        if (method === 'GET') return { status: 200, body: { password_configured: Boolean(user.password_hash) } };
        if (method === 'POST') {
          const newPassword = str(body.new_password, 'new_password', { required: true, min: 8, max: 128, trim: false })!;
          const currentPassword = str(body.current_password, 'current_password', { max: 128, trim: false });
          if (user.password_hash) {
            if (!currentPassword) throw new ApiError(400, 'current_password is required');
            if (!(await verifyPassword(currentPassword, user.password_hash))) {
              throw new ApiError(403, 'Current password is incorrect');
            }
          }
          const hash = await hashPassword(newPassword);
          this.db.mutate((data) => {
            const target = data.users.find((row) => row.user_id === user.user_id);
            if (target) target.password_hash = hash;
          });
          return { status: 200, body: { ok: true, password_configured: true } };
        }
      }

      if (action === 'connect' && method === 'POST') {
        const idToken = str(body.id_token, 'id_token', { required: true, max: 8192, trim: false })!;
        const returnTo = str(body.return_to, 'return_to', { max: 512 }) ?? '/';
        const { claims } = await verifyIdToken(idToken, {
          issuer: claimsIssuer(),
          audience: '9',
        });
        const sub = claims.sub ?? claims.email;
        let user = this.db.findUserByConnectSub(sub);
        if (!user) {
          const base = (claims.preferred_username ?? claims.email?.split('@')[0] ?? 'user')
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, 24) || 'user';
          let username = base.length < 3 ? `${base}user`.slice(0, 24) : base;
          let suffix = 0;
          while (this.db.findUserByUsername(username)) {
            suffix += 1;
            username = `${base.slice(0, 20)}${suffix}`;
          }
          user = this.db.createUser({
            name: claims.name ?? claims.preferred_username ?? username,
            username,
            connect_sub: sub,
            email: claims.email ?? null,
          });
        }
        const session = this.db.createSession(user.user_id);
        return {
          status: 200,
          body: {
            user: toPublicUser(user),
            return_to: returnTo.startsWith('/') ? returnTo : '/',
            token_verified: true,
            session_id: session.session_id,
          },
        };
      }

      throw new ApiError(404, 'Not found');
    }

    /* ------------------------------ users ------------------------------ */
    if (rest[0] === 'users') {
      if (rest[1] === 'me' && method === 'GET') {
        const user = this.requireUser(token);
        return {
          status: 200,
          body: { ...toPublicUser(user), password_configured: Boolean(user.password_hash) },
        };
      }

      const userId = rest[1];
      const target = userId && isUuid(userId) ? this.db.findUser(userId) : null;
      if (!target) throw new ApiError(404, 'User not found');
      const viewer = this.viewer(token);
      const data = this.db.read();

      if (rest.length === 2 && method === 'GET') {
        return { status: 200, body: toPublicUser(target) };
      }

      if (rest[2] === 'scripts' && method === 'GET') {
        const isOwner = viewer?.user_id === target.user_id;
        const rows = data.scripts
          .filter((script) => script.author_uuid === target.user_id)
          .filter((script) => isOwner || script.published_at !== null)
          .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        const limit = int(q.get('limit'), 'limit', { min: 1, max: 200, fallback: 100 })!;
        const offset = int(q.get('offset'), 'offset', { min: 0, fallback: 0 })!;
        return {
          status: 200,
          body: {
            scripts: rows.slice(offset, offset + limit).map((script) => toListItem(data, script, viewer?.user_id ?? null)),
            total: rows.length,
          },
        };
      }

      if (rest[2] === 'favorites' && method === 'GET') {
        const rows = data.scripts
          .filter((script) => script.favorites.includes(target.user_id) && script.published_at !== null)
          .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
        return {
          status: 200,
          body: {
            scripts: rows.map((script) => toListItem(data, script, viewer?.user_id ?? null)),
            total: rows.length,
          },
        };
      }

      throw new ApiError(404, 'Not found');
    }

    /* ----------------------------- scripts ----------------------------- */
    if (rest[0] === 'scripts') {
      if (rest.length === 1) {
        if (method === 'GET') {
          const user = this.viewer(token);
          if (!user) throw new ApiError(401, 'Unauthorized', null);
          const data = this.db.read();
          const limit = int(q.get('limit'), 'limit', { min: 1, max: 100, fallback: 24 })!;
          const offset = int(q.get('offset'), 'offset', { min: 0, fallback: 0 })!;
          const sortParam = q.get('sort');
          const sort = sortParam === 'updated' || sortParam === 'name' ? sortParam : 'recent';
          const search = (q.get('search') ?? q.get('q') ?? '').trim().toLowerCase();
          const author = q.get('author');

          let rows = data.scripts.filter((script) => script.published_at !== null);
          if (author) rows = rows.filter((script) => script.author_uuid === author);
          if (search) {
            rows = rows.filter(
              (script) =>
                script.name.toLowerCase().includes(search) ||
                (script.description ?? '').toLowerCase().includes(search) ||
                authorName(data, script.author_uuid).toLowerCase().includes(search),
            );
          }
          rows = [...rows].sort((a, b) => {
            if (sort === 'name') return a.name.localeCompare(b.name);
            if (sort === 'updated') return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
            return (b.published_at ?? '').localeCompare(a.published_at ?? '');
          });
          return {
            status: 200,
            body: {
              scripts: rows.slice(offset, offset + limit).map((script) => toListItem(data, script, user.user_id)),
              total: rows.length,
              limit,
              offset,
            },
          };
        }

        if (method === 'POST') {
          const user = this.requireUser(token);
          const name = str(body.name, 'name', { required: true, max: 120 })!;
          const description = str(body.description, 'description', { max: 4000 });
          const code = str(body.code, 'code', { max: 512 * 1024, trim: false });
          const script = this.db.createScript({
            author_uuid: user.user_id,
            name,
            description: description ?? null,
            code,
            publish: body.publish === true,
          });
          return { status: 201, body: toDetail(this.db.read(), script, user.user_id) };
        }
      }

      const scriptId = rest[1];
      const script = scriptId && isUuid(scriptId) ? this.db.findScript(scriptId) : null;
      const viewer = this.viewer(token);
      if (!script || !canView(script, viewer?.user_id ?? null)) {
        throw new ApiError(404, 'Script not found');
      }
      const data = this.db.read();

      if (rest.length === 2) {
        if (method === 'GET') return { status: 200, body: toDetail(data, script, viewer?.user_id ?? null) };

        if (method === 'PATCH' || method === 'DELETE') {
          const user = this.requireUser(token);
          if (script.author_uuid !== user.user_id) throw new ApiError(403, 'Forbidden');
          if (method === 'DELETE') {
            this.db.deleteScript(script.script_id);
            return { status: 200, body: { ok: true } };
          }
          const patch: Parameters<VirtualDatabase['updateScript']>[1] = {};
          if ('name' in body) patch.name = str(body.name, 'name', { required: true, max: 120 });
          if ('description' in body) {
            if (body.description === null || body.description === '') patch.description = null;
            else patch.description = str(body.description, 'description', { max: 4000 }) ?? null;
          }
          if ('code' in body) patch.code = str(body.code, 'code', { max: 512 * 1024, trim: false });
          const updated = this.db.updateScript(script.script_id, patch);
          return { status: 200, body: toDetail(this.db.read(), updated!, user.user_id) };
        }
      }

      if (rest[2] === 'code') {
        const user = this.requireUser(token);
        if (script.author_uuid !== user.user_id) throw new ApiError(403, 'Forbidden');
        if (method === 'GET') {
          return { status: 200, body: { script_id: script.script_id, code: script.code, updated_at: script.updated_at } };
        }
        if (method === 'PUT') {
          const code = str(body.code, 'code', { required: true, max: 512 * 1024, trim: false })!;
          const updated = this.db.updateScript(script.script_id, { code })!;
          return {
            status: 200,
            body: { script_id: script.script_id, code: updated.code, updated_at: updated.updated_at, published_at: updated.published_at },
          };
        }
      }

      if (rest[2] === 'publish' && rest.length === 3) {
        const user = this.requireUser(token);
        if (script.author_uuid !== user.user_id) throw new ApiError(403, 'Forbidden');
        if (method !== 'POST') throw new ApiError(405, 'Method not allowed', null);
        const description = str(body.description, 'description', { max: 4000 });
        const result = this.db.publishScript(script.script_id)!;
        if (description !== undefined) {
          this.db.mutate((current) => {
            const release = current.releases.find((row) => row.id === result.release.id);
            if (release) release.description = description;
          });
        }
        return {
          status: 200,
          body: {
            script_id: result.script.script_id,
            published_at: result.script.published_at,
            release: toReleaseSummary(result.release),
          },
        };
      }

      if (rest[2] === 'share' && rest.length === 3) {
        const user = this.requireUser(token);
        if (script.author_uuid !== user.user_id) throw new ApiError(403, 'Forbidden');
        if (method !== 'POST') throw new ApiError(405, 'Method not allowed', null);
        if (script.published_at === null) throw new ApiError(409, 'Script is not published');
        const expiresIn = int(body.expires_in, 'expires_in', { min: 60, max: 60 * 60 * 24 * 30 });
        const releaseId = int(body.release_id, 'release_id', { min: 1 });
        const releases = data.releases
          .filter((release) => release.script_id === script.script_id)
          .sort((a, b) => b.id - a.id);
        const target = releaseId ? releases.find((release) => release.id === releaseId) : releases[0];
        if (!target) throw new ApiError(404, 'Release not found');

        const share = {
          token: opaqueToken(),
          script_id: script.script_id,
          release_id: target.id,
          created_by: user.user_id,
          created_at: nowIso(),
          expires_at: new Date(Date.now() + (expiresIn ?? 86400) * 1000).toISOString(),
          uses: 0,
        };
        this.db.mutate((current) => {
          current.shares.push(share);
        });
        const origin = typeof location === 'undefined' ? '' : location.origin + basePath();
        return {
          status: 201,
          body: {
            token: share.token,
            url: `${origin}/b/${share.token}`,
            share_url: `${origin}/b/${share.token}`,
            link: `${origin}/b/${share.token}`,
            deep_link: `nullsbrawl://script/${share.token}`,
            script_id: script.script_id,
            release_id: target.id,
            expires_at: share.expires_at,
            created_at: share.created_at,
          },
        };
      }

      if (rest[2] === 'content' && rest.length === 3) {
        if (method !== 'GET' && method !== 'HEAD') throw new ApiError(405, 'Method not allowed', null);
        const tokenParam = q.get('token');
        if (!tokenParam) throw new ApiError(401, 'Unauthorized', null);
        let claims;
        try {
          claims = await verifyContentToken(tokenParam);
        } catch (error) {
          if (error instanceof InviteError) throw new ApiError(error.status, error.message);
          throw error;
        }
        if (claims.script_id !== script.script_id) throw new ApiError(403, 'Token does not match this script');
        if (script.published_at === null) throw new ApiError(404, 'Script not found');
        const release = data.releases.find(
          (row) => row.id === claims.revision_id && row.script_id === script.script_id,
        );
        if (!release) throw new ApiError(404, 'Revision not found');

        if (q.get('format') === 'json') {
          return {
            status: 200,
            body: {
              script_id: script.script_id,
              revision_id: release.id,
              name: script.name,
              description: script.description,
              content: release.code,
              created_at: release.created_at,
              expires_at: new Date(claims.exp * 1000).toISOString(),
            },
          };
        }
        return { status: 200, body: null, text: release.code, contentType: 'text/plain; charset=utf-8' };
      }

      if (rest[2] === 'invite' && rest.length === 3) {
        if (method !== 'POST') throw new ApiError(405, 'Method not allowed', null);
        const user = this.requireUser(token);
        if (script.published_at === null && script.author_uuid !== user.user_id) {
          throw new ApiError(403, 'Only the author can invite to a draft');
        }
        const releaseId = int(body.release_id, 'release_id', { min: 1 });
        const expiresIn = int(body.expires_in, 'expires_in', { min: 60, max: 60 * 60 * 24 * 30 });
        const releases = data.releases
          .filter((row) => row.script_id === script.script_id)
          .sort((a, b) => b.id - a.id);
        const release = releaseId ? releases.find((row) => row.id === releaseId) : releases[0];
        if (!release) {
          throw new ApiError(404, releaseId ? 'Release not found' : 'Script has no published revision');
        }

        const ttl = expiresIn ?? DEFAULT_INVITE_TTL_SECONDS;
        const contentToken = await signContentToken({
          script_id: script.script_id,
          revision_id: release.id,
          ttlSeconds: ttl,
        });
        const origin = requestOrigin(init);
        const contentUrl = `${origin}/api/scripts/${script.script_id}/content?token=${contentToken}`;
        const invite = buildInvite({ contentUrl, realm: typeof body.realm === 'string' ? body.realm : undefined, bp: body.bp });
        const expiresAt = new Date(Math.floor(Date.now() / 1000) * 1000 + ttl * 1000).toISOString();
        return {
          status: 201,
          body: {
            realm: invite.realm,
            script: invite.script,
            bp: invite.bp,
            invite,
            payload: serialiseInvite(invite),
            invite_b64: encodeInvite(invite),
            invite_url: inviteImportUrl(invite, origin),
            deep_link: inviteDeepLink(invite),
            token: contentToken,
            content_url: contentUrl,
            script_id: script.script_id,
            revision_id: release.id,
            name: script.name,
            realm_name: invite.realm,
            expires_at: expiresAt,
            created_at: nowIso(),
          },
        };
      }

      if (rest[2] === 'favorite') {
        const user = this.requireUser(token);
        if (method !== 'POST' && method !== 'DELETE') throw new ApiError(405, 'Method not allowed', null);
        const favorite = method === 'POST';
        const updated = this.db.toggleFavorite(script.script_id, user.user_id, favorite);
        return {
          status: 200,
          body: { script_id: script.script_id, is_favorite: favorite, favorites: updated?.favorites.length ?? 0 },
        };
      }

      if (rest[2] === 'releases') {
        if (rest.length === 3 && method === 'GET') {
          const releases = data.releases
            .filter((release) => release.script_id === script.script_id)
            .sort((a, b) => b.id - a.id)
            .map(toReleaseSummary);
          return { status: 200, body: { releases } };
        }
        if (rest.length === 4 && method === 'GET') {
          const id = Number(rest[3]);
          const release = data.releases.find((row) => row.id === id && row.script_id === script.script_id);
          if (!release) throw new ApiError(404, 'Release not found');
          const payload: Record<string, unknown> = {
            ...toReleaseSummary(release),
            script_id: release.script_id,
            author_uuid: release.author_uuid,
          };
          if (viewer?.user_id === script.author_uuid) payload.code = release.code;
          return { status: 200, body: payload };
        }
      }
    }

    /* --------------------------- import --------------------------- */
    if (rest[0] === 'import' && rest[1] === 'inspect') {
      if (method !== 'POST') throw new ApiError(405, 'Method not allowed', null);
      const inviteRaw = typeof body.invite === 'string' ? body.invite : undefined;
      const urlRaw = typeof body.url === 'string' ? body.url : undefined;
      if (!inviteRaw && !urlRaw) throw new ApiError(400, 'Provide an invite payload or a script URL');

      let scriptUrl: string;
      let realm = 'experiment:scripts';
      let bp: number[] | null = null;
      if (inviteRaw) {
        let invite;
        try {
          invite = (await import('../invite')).decodeInvite(inviteRaw);
        } catch (error) {
          if (error instanceof InviteError) throw new ApiError(400, error.message);
          throw error;
        }
        scriptUrl = invite.script;
        realm = invite.realm;
        bp = invite.bp;
      } else {
        try {
          scriptUrl = (await import('../invite')).validateInvite({ realm, script: urlRaw!, bp: [] }).script;
        } catch (error) {
          if (error instanceof InviteError) throw new ApiError(400, error.message);
          throw error;
        }
      }

      let fetched;
      try {
        fetched = await fetchScriptContent(scriptUrl, { allowLocal: true });
      } catch (error) {
        if (error instanceof ImportFetchError) throw new ApiError(error.status, error.message);
        throw error;
      }

      let scriptId: string | null = null;
      let revisionId: number | null = null;
      let expiresAt: string | null = null;
      try {
        const parsed = new URL(fetched.finalUrl);
        const match = parsed.pathname.match(/\/api\/scripts\/([0-9a-f-]{36})\/content/i);
        if (match) scriptId = match[1];
        const contentToken = parsed.searchParams.get('token');
        if (contentToken && contentToken.split('.').length === 3) {
          const b64 = contentToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
          const claims = JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '='))) as {
            revision_id?: number;
            exp?: number;
          };
          if (typeof claims.revision_id === 'number') revisionId = claims.revision_id;
          if (typeof claims.exp === 'number') expiresAt = new Date(claims.exp * 1000).toISOString();
        }
      } catch {
        /* not a tokenised URL */
      }

      return {
        status: 200,
        body: {
          realm,
          script: fetched.finalUrl,
          bp: bp ?? [],
          name: fetched.name || (await import('../invite')).guessScriptName(fetched.finalUrl),
          content: fetched.content,
          content_type: fetched.contentType,
          bytes: fetched.bytes,
          script_id: scriptId,
          revision_id: revisionId,
          expires_at: expiresAt,
          imported_by: this.viewer(token)?.username ?? null,
        },
      };
    }

    /* ------------------------------ share ------------------------------ */
    if (rest[0] === 'share' && rest[1] && method === 'GET') {
      const data = this.db.read();
      const share = data.shares.find((row) => row.token === rest[1]);
      if (!share) throw new ApiError(404, 'Share not found');
      if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
        throw new ApiError(410, 'Share expired');
      }
      const script = data.scripts.find((row) => row.script_id === share.script_id);
      const release = data.releases.find((row) => row.id === share.release_id);
      if (!script || !release) throw new ApiError(404, 'Share not found');
      return {
        status: 200,
        body: {
          token: share.token,
          script_id: share.script_id,
          release_id: share.release_id,
          created_at: share.created_at,
          expires_at: share.expires_at,
          uses: share.uses,
          script: toDetail(data, script, null),
          release: {
            id: release.id,
            description: release.description,
            created_at: release.created_at,
            code: release.code,
          },
        },
      };
    }

    throw new ApiError(404, 'Not found');
  }

  /** Seed helper used by the static build so the deployed demo is never empty. */
  async seed(): Promise<{ created: boolean; accounts: { username: string; password: string; user_id: string }[] }> {
    const data = this.db.read();
    if (data.scripts.length > 0) return { created: false, accounts: [] };

    const password = 'demo1234';
    const hash = await hashPassword(password);
    const demo = this.db.createUser({ name: 'Demo Author', username: 'demo', password_hash: hash });
    const arena = this.db.createUser({ name: 'Arena Dev', username: 'arena', password_hash: hash });

    const scripts = [
      {
        author: demo.user_id,
        name: 'Hello Tick',
        description:
          'Minimal starting point: proves that the script is loaded into the friendly battle and that tick() is called every game tick.',
        code: `-- Hello Tick — minimal NB Scripting example
local ticks = 0

function tick()
    ticks = ticks + 1
    if ticks % 20 == 0 then
        log("tick " .. ticks .. " in " .. server.gameMode)
    end
end
`,
      },
      {
        author: demo.user_id,
        name: 'Damage Announcer',
        description:
          'Subscribes to takingDamageListeners on every character and announces large hits in the room chat.',
        code: `-- Damage Announcer
local function subscribe(character)
    local callback = createCallback("DamageEventListener", function(source, projectile, damage, data, origin)
        if damage >= 2000 then
            log(character.data.name .. " took " .. math.floor(damage) .. " damage")
        end
    end)
    character.takingDamageListeners:add(callback)
end

function tick()
    for i, character in server.objectManager:getCharacters() do
        if not character.__watched then
            character.__watched = true
            subscribe(character)
        end
    end
end
`,
      },
      {
        author: demo.user_id,
        name: 'Pin Box Spawner',
        description: 'Spawns a box obstacle at the map pin position. Useful for building small obstacle courses.',
        code: `-- Pin Box Spawner
local spawned = {}

function tick()
    for i, character in server.objectManager:getCharacters() do
        local pin = character.pin
        if pin and not spawned[character.index] then
            spawned[character.index] = true
            local data = lookup(18, "box")
            if data then
                local object = createObject(data)
                object.x = pin.x
                object.y = pin.y
                server.objectManager:addObject(object)
            end
        end
    end
end
`,
      },
      {
        author: arena.user_id,
        name: 'Everybody Random Trait',
        description: 'Gives every player a random trait every 3 seconds. Chaos mode — high crash risk, use with friends only.',
        code: `-- Everybody Random Trait
local elapsed = 0

function tick()
    elapsed = elapsed + 1
    if elapsed % 60 ~= 0 then return end

    for i, character in server.objectManager:getCharacters() do
        local trait = lookup(108, "random")
        if trait then
            log("random trait for " .. character.data.name)
        end
    end
end
`,
      },
      {
        author: arena.user_id,
        name: 'Coin Rain',
        description: 'Coins spawn randomly around the map every second. Collect them to buy buffs.',
        code: `-- Coin Rain
local coins = 0

function tick()
    if server.tick % 20 ~= 0 then return end
    local data = lookup(18, "coin")
    if not data then return end
    local object = createObject(data)
    object.x = math.random(-800, 800)
    object.y = math.random(-800, 800)
    server.objectManager:addObject(object)
    coins = coins + 1
end
`,
      },
      {
        author: arena.user_id,
        name: 'Hide Everything',
        description: 'Nobody can see other players, projectiles or items — except objective objects such as the ball in Brawl Ball.',
        code: `-- Hide Everything
function tick()
    for i, character in server.objectManager:getCharacters() do
        character.visible = false
    end
    for i, projectile in server.objectManager:getProjectiles() do
        projectile.visible = false
    end
end
`,
      },
    ];

    const created = scripts.map((script) =>
      this.db.createScript({
        author_uuid: script.author,
        name: script.name,
        description: script.description,
        code: script.code,
        publish: true,
      }),
    );

    this.db.toggleFavorite(created[1].script_id, arena.user_id, true);
    this.db.toggleFavorite(created[3].script_id, demo.user_id, true);

    return {
      created: true,
      accounts: [
        { username: 'demo', password, user_id: demo.user_id },
        { username: 'arena', password, user_id: arena.user_id },
      ],
    };
  }

  static claimsForEmail(email: string, clientId: string, issuer: string) {
    return claimsForEmail(email, clientId, issuer);
  }

  static signIdToken(claims: Parameters<typeof signIdToken>[0], secret?: string) {
    return signIdToken(claims, secret);
  }

  static uuidv7 = uuidv7;
}

function claimsIssuer(): string | undefined {
  return typeof location === 'undefined' ? undefined : location.origin;
}

function basePath(): string {
  const configured = typeof window === 'undefined' ? '' : (window as unknown as { __NT_BASE__?: string }).__NT_BASE__;
  return configured ?? '';
}
