import { currentUser } from './auth';
import { HttpError } from './http';
import { db, findScript } from './store';
import type { ScriptRow, UserRow } from './types';
import { isUuid } from './ids';

export async function requireUser(): Promise<UserRow> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Unauthorized');
  return user;
}

export async function optionalUser(): Promise<UserRow | null> {
  return currentUser();
}

export async function requireScript(id: string): Promise<ScriptRow> {
  if (!isUuid(id)) throw new HttpError(404, 'Script not found');
  const script = await findScript(id);
  if (!script) throw new HttpError(404, 'Script not found');
  return script;
}

export async function requireOwnedScript(id: string, user: UserRow): Promise<ScriptRow> {
  const script = await requireScript(id);
  if (script.author_uuid !== user.user_id) throw new HttpError(403, 'Forbidden');
  return script;
}

export async function findUserOr404(id: string): Promise<UserRow> {
  if (!isUuid(id)) throw new HttpError(404, 'User not found');
  const data = await db();
    const user = data.users.find((candidate) => candidate.user_id === id);
  if (!user) throw new HttpError(404, 'User not found');
  return user;
}

/**
 * Scripts that are visible to a given viewer: published scripts plus the
 * viewer's own drafts. Anything else behaves as if it did not exist.
 */
export function canView(script: ScriptRow, viewerId: string | null): boolean {
  return script.published_at !== null || script.author_uuid === viewerId;
}
