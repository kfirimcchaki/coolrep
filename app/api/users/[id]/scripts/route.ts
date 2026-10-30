import { currentUser } from '../../../../../lib/auth';
import { findUserOr404 } from '../../../../../lib/api-helpers';
import { handleError, intParam, json } from '../../../../../lib/http';
import { listUserScripts } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/users/{uuid}/scripts → { scripts: [...] } */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await findUserOr404(id);
    const viewer = await currentUser();
    const url = new URL(request.url);
    const result = await listUserScripts(id, viewer?.user_id ?? null, {
      limit: intParam(url.searchParams.get('limit'), 'limit', { min: 1, max: 200, fallback: 100 }),
      offset: intParam(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 }),
    });
    return json({ scripts: result.scripts, total: result.total });
  } catch (error) {
    return handleError(error);
  }
}
