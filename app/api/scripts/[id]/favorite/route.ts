import { currentUser } from '../../../../../lib/auth';
import { canView } from '../../../../../lib/api-helpers';
import { handleError, HttpError, json } from '../../../../../lib/http';
import { findScript, toggleFavorite } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function act(params: Ctx['params'], favorite: boolean) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) throw new HttpError(401, 'Unauthorized');
  const script = await findScript(id);
  if (!script || !canView(script, user.user_id)) throw new HttpError(404, 'Script not found');
  const updated = await toggleFavorite(id, user.user_id, favorite);
  return json({ script_id: id, is_favorite: favorite, favorites: updated?.favorites.length ?? 0 });
}

/** POST /api/scripts/{uuid}/favorite */
export async function POST(_request: Request, { params }: Ctx) {
  try {
    return await act(params, true);
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/scripts/{uuid}/favorite */
export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    return await act(params, false);
  } catch (error) {
    return handleError(error);
  }
}
