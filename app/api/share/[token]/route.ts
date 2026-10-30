import { handleError, HttpError, json } from '../../../../lib/http';
import { db, toScriptDetail } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ token: string }> };

/**
 * GET /api/share/{token} — resolves a friendly-battle launch link.
 * Used by the /b/{token} page and by the game client.
 */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { token } = await params;
    const data = await db();
    const share = data.shares.find((candidate) => candidate.token === token);
    if (!share) throw new HttpError(404, 'Share not found');
    if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
      throw new HttpError(410, 'Share expired');
    }

    const script = data.scripts.find((candidate) => candidate.script_id === share.script_id);
    const release = data.releases.find((candidate) => candidate.id === share.release_id);
    if (!script || !release) throw new HttpError(404, 'Share not found');

    return json({
      token: share.token,
      script_id: share.script_id,
      release_id: share.release_id,
      created_at: share.created_at,
      expires_at: share.expires_at,
      uses: share.uses,
      script: toScriptDetail(data, script, null),
      release: {
        id: release.id,
        description: release.description,
        created_at: release.created_at,
        code: release.code,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
