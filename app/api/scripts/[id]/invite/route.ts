import { currentUser } from '../../../../../lib/auth';
import { canView } from '../../../../../lib/api-helpers';
import { db, findScript } from '../../../../../lib/store';
import { handleError, HttpError, intParam, readJson, stringParam } from '../../../../../lib/http';
import { isUuid, toApiTime } from '../../../../../lib/ids';
import {
  buildInvite,
  DEFAULT_INVITE_TTL_SECONDS,
  encodeInvite,
  inviteDeepLink,
  inviteImportUrl,
  serialiseInvite,
  signContentToken,
} from '../../../../../lib/invite';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Absolute origin of this deployment, honouring APP_URL behind a proxy. */
function originOf(request: Request): string {
  const configured = process.env.APP_URL?.replace(/\/+$/, '');
  if (configured && /^https?:\/\//i.test(configured)) return configured;
  const url = new URL(request.url);
  // Behind a proxy / a 0.0.0.0 bind the Host header is the truth.
  const host = request.headers.get('host') || url.host;
  const proto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '');
  return `${proto}://${host}`;
}

/**
 * POST /api/scripts/{uuid}/invite
 *
 * Mints a friendly-battle invite: a content token plus the JSON document the
 * game client (or another script site) consumes.
 *
 * body (all optional):
 *   { release_id?: number, expires_in?: seconds, bp?: number[], realm?: string }
 *
 * Signed-in users may invite anyone to *published* scripts; drafts stay private
 * to their author. The response is a superset of the document itself:
 *
 *   { realm, script, bp,                     ← the invite document, verbatim
 *     payload: "<pretty JSON>", invite: {...},
 *     invite_url, deep_link, invite_b64,
 *     token, expires_at, content_url, script_id, revision_id, name }
 */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) throw new HttpError(404, 'Script not found');

    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');

    const script = await findScript(id);
    if (!script || !canView(script, user.user_id)) throw new HttpError(404, 'Script not found');

    // Only the author may hand out links for a draft.
    if (script.published_at === null && script.author_uuid !== user.user_id) {
      throw new HttpError(403, 'Only the author can invite to a draft');
    }

    let releaseId: number | undefined;
    let expiresIn: number | undefined;
    let bp: unknown;
    let realm: string | undefined;
    const raw = await request.text();
    if (raw.trim()) {
      const body = JSON.parse(raw) as Record<string, unknown>;
      releaseId = intParam(body.release_id, 'release_id', { min: 1 });
      expiresIn = intParam(body.expires_in, 'expires_in', { min: 60, max: 60 * 60 * 24 * 30 });
      bp = body.bp;
      realm = stringParam(body.realm, 'realm', { max: 64 }) ?? undefined;
    }

    const data = await db();
    const ownReleases = data.releases.filter((row) => row.script_id === id);
    const release = releaseId
      ? ownReleases.find((row) => row.id === releaseId)
      : [...ownReleases].sort((a, b) => b.id - a.id)[0];
    if (!release) {
      throw new HttpError(404, releaseId ? 'Release not found' : 'Script has no published revision');
    }

    const ttl = expiresIn ?? DEFAULT_INVITE_TTL_SECONDS;
    const token = await signContentToken({ script_id: id, revision_id: release.id, ttlSeconds: ttl });
    const origin = originOf(request);
    const contentUrl = `${origin}/api/scripts/${id}/content?token=${token}`;
    const invite = buildInvite({ contentUrl, realm, bp });
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { exp: number };

    return Response.json(
      {
        // the document itself — paste this into the game client
        realm: invite.realm,
        script: invite.script,
        bp: invite.bp,

        // convenience mirrors of the same thing
        invite,
        payload: serialiseInvite(invite),
        invite_b64: encodeInvite(invite),
        invite_url: inviteImportUrl(invite, origin),
        deep_link: inviteDeepLink(invite),

        // metadata
        token,
        content_url: contentUrl,
        script_id: script.script_id,
        revision_id: release.id,
        name: script.name,
        realm_name: invite.realm,
        expires_at: toApiTime(new Date(claims.exp * 1000)),
        created_at: toApiTime(new Date()),
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleError(error);
  }
}

/** Invites are minted with POST. */
export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
