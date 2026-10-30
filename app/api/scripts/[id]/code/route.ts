import { currentUser } from '../../../../../lib/auth';
import { requireOwnedScript } from '../../../../../lib/api-helpers';
import { handleError, HttpError, json, readJson, stringParam } from '../../../../../lib/http';
import { db, findScript, updateScript } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/scripts/{uuid}/code — draft source, owner only. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    const script = await requireOwnedScript(id, user);
    return json({
      script_id: script.script_id,
      code: script.code,
      updated_at: script.updated_at,
    });
  } catch (error) {
    return handleError(error);
  }
}

/** PUT /api/scripts/{uuid}/code — save draft source, owner only. */
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    await requireOwnedScript(id, user);

    const body = await readJson(request);
    const code = stringParam(body.code, 'code', { max: 512 * 1024, trim: false, required: true });
    const updated = await updateScript(id, { code: code! });
    const data = await db();
    return json({
      script_id: id,
      code: updated!.code,
      updated_at: updated!.updated_at,
      published_at: updated!.published_at,
    });
  } catch (error) {
    return handleError(error);
  }
}

/** HEAD is not part of the contract, but answering keeps probes tidy. */
export async function HEAD(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const script = await findScript(id);
  return new Response(null, { status: script ? 200 : 404 });
}
