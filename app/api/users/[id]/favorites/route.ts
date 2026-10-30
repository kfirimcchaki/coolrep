import { currentUser } from '../../../../../lib/auth';
import { findUserOr404 } from '../../../../../lib/api-helpers';
import { handleError, json } from '../../../../../lib/http';
import { listUserFavorites } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/users/{uuid}/favorites → { scripts: [...] } */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await findUserOr404(id);
    const viewer = await currentUser();
    const result = await listUserFavorites(id, viewer?.user_id ?? null);
    return json({ scripts: result.scripts, total: result.total });
  } catch (error) {
    return handleError(error);
  }
}
