import { currentUser } from '../../../../lib/auth';
import { canView, requireOwnedScript } from '../../../../lib/api-helpers';
import { handleError, HttpError, json, readJson, stringParam } from '../../../../lib/http';
import { db, deleteScript, findScript, toScriptDetail, updateScript } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/scripts/{uuid} — public for published scripts. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const script = await findScript(id);
    const viewer = await currentUser();
    if (!script || !canView(script, viewer?.user_id ?? null)) {
      throw new HttpError(404, 'Script not found');
    }
    const data = await db();
    return json(toScriptDetail(data, script, viewer?.user_id ?? null));
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH /api/scripts/{uuid} — owner only. */
export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    const script = await requireOwnedScript(id, user);

    const body = await readJson(request);
    const patch: Parameters<typeof updateScript>[1] = {};
    if ('name' in body) patch.name = stringParam(body.name, 'name', { required: true, max: 120 });
    if ('description' in body) {
      const value = body.description;
      if (value === null || value === '') patch.description = null;
      else patch.description = stringParam(value, 'description', { max: 4000 }) ?? null;
    }
    if ('code' in body) patch.code = stringParam(body.code, 'code', { max: 512 * 1024, trim: false });
    if ('user_map_id' in body) {
      patch.user_map_id = stringParam(body.user_map_id, 'user_map_id', { max: 64 }) ?? script.user_map_id;
    }
    if ('user_map_internal_id' in body) {
      patch.user_map_internal_id =
        stringParam(body.user_map_internal_id, 'user_map_internal_id', { max: 64 }) ??
        script.user_map_internal_id;
    }

    const updated = await updateScript(id, patch);
    const data = await db();
    return json(toScriptDetail(data, updated!, user.user_id));
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/scripts/{uuid} — owner only. */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    await requireOwnedScript(id, user);
    await deleteScript(id);
    return json({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
