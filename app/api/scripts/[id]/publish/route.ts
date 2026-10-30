import { currentUser } from '../../../../../lib/auth';
import { requireOwnedScript } from '../../../../../lib/api-helpers';
import { handleError, HttpError, json, stringParam } from '../../../../../lib/http';
import { publishScript, toReleaseSummary } from '../../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/scripts/{uuid}/publish
 * Publishes the current draft and snapshots it as a new release.
 * Optional body: { description }
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    await requireOwnedScript(id, user);

    // Body is optional for this endpoint.
    let description: string | undefined;
    const raw = await request.text();
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        description = stringParam(parsed.description, 'description', { max: 4000 });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, 'Malformed JSON body');
      }
    }

    const result = await publishScript(id);
    if (!result) throw new HttpError(404, 'Script not found');
    if (description !== undefined) result.release.description = description;

    return json({
      script_id: result.script.script_id,
      published_at: result.script.published_at,
      release: toReleaseSummary(result.release),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
