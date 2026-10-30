import { currentUser } from '../../../../../../lib/auth';
import { canView } from '../../../../../../lib/api-helpers';
import { handleError, HttpError, json } from '../../../../../../lib/http';
import { db, findScript, toReleaseSummary } from '../../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string; releaseId: string }> };

/** GET /api/scripts/{uuid}/releases/{id} — release metadata (+ code for the owner). */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id, releaseId } = await params;
    const numericId = Number(releaseId);
    if (!Number.isInteger(numericId)) throw new HttpError(404, 'Release not found');

    const data = await db();
    const script = await findScript(id);
    const viewer = await currentUser();
    if (!script || !canView(script, viewer?.user_id ?? null)) {
      throw new HttpError(404, 'Script not found');
    }
    const release = data.releases.find((r) => r.id === numericId && r.script_id === id);
    if (!release) throw new HttpError(404, 'Release not found');

    const payload: Record<string, unknown> = {
      ...toReleaseSummary(release),
      script_id: release.script_id,
      author_uuid: release.author_uuid,
    };
    if (viewer?.user_id === script.author_uuid) payload.code = release.code;
    return json(payload);
  } catch (error) {
    return handleError(error);
  }
}
