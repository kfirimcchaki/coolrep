import { currentUser } from '../../../../../lib/auth';
import { canView } from '../../../../../lib/api-helpers';
import { handleError, HttpError, json } from '../../../../../lib/http';
import { findScript, listReleases } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/scripts/{uuid}/releases — public release history. */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const script = await findScript(id);
    const viewer = await currentUser();
    if (!script || !canView(script, viewer?.user_id ?? null)) {
      throw new HttpError(404, 'Script not found');
    }
    return json({ releases: await listReleases(id) });
  } catch (error) {
    return handleError(error);
  }
}
