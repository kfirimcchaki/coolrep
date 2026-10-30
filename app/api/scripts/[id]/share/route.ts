import { currentUser } from '../../../../../lib/auth';
import { requireOwnedScript } from '../../../../../lib/api-helpers';
import { handleError, HttpError, json, readJson, intParam } from '../../../../../lib/http';
import { db, transact } from '../../../../../lib/store';
import { nowIso, opaqueToken } from '../../../../../lib/ids';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/scripts/{uuid}/share
 *
 * Creates (or re-uses) a launch token for a "friendly battle" and returns the
 * deep link the game client consumes. This is the endpoint behind the
 * "Start friendly battle" button on the script page.
 *
 * body (all optional): { expires_in?: seconds, release_id?: number }
 *
 * The upstream response shape is not publicly documented; we answer with a
 * superset so any client expecting `url`, `share_url` or `link` keeps working.
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    const script = await requireOwnedScript(id, user);

    if (script.published_at === null) {
      throw new HttpError(409, 'Script is not published');
    }

    let expiresIn: number | undefined;
    let releaseId: number | undefined;
    const raw = await request.text();
    if (raw.trim()) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      expiresIn = intParam(body.expires_in, 'expires_in', { min: 60, max: 60 * 60 * 24 * 30 });
      releaseId = intParam(body.release_id, 'release_id', { min: 1 });
    }

    const data = await db();
    const latestRelease = [...data.releases]
      .filter((r) => r.script_id === script.script_id)
      .sort((a, b) => b.id - a.id)[0];
    const targetRelease = releaseId
      ? data.releases.find((r) => r.id === releaseId && r.script_id === script.script_id)
      : latestRelease;
    if (!targetRelease) throw new HttpError(404, 'Release not found');

    const token = opaqueToken(18);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + (expiresIn ?? 60 * 60 * 24) * 1000).toISOString();

    await transact((current) => {
      current.shares.push({
        token,
        script_id: script.script_id,
        release_id: targetRelease.id,
        created_by: user.user_id,
        created_at: createdAt,
        expires_at: expiresAt,
        uses: 0,
      });
    });

    const origin = new URL(request.url).origin;
    const url = `${origin}/b/${token}`;

    return json({
      token,
      url,
      share_url: url,
      link: url,
      deep_link: `nullsbrawl://script/${token}`,
      script_id: script.script_id,
      release_id: targetRelease.id,
      expires_at: expiresAt,
      created_at: createdAt,
    }, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}

/** GET on the share endpoint is not part of the contract (405 in the original). */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
