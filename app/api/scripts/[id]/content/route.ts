import { handleError, HttpError, json } from '../../../../../lib/http';
import { db, findScript } from '../../../../../lib/store';
import { isUuid } from '../../../../../lib/ids';
import { InviteError, verifyContentToken } from '../../../../../lib/invite';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/scripts/{uuid}/content?token=<jwt>
 *
 * The URL a friendly-battle invite points at: it returns the *source code* of a
 * published revision, authorised by the invite token alone (no cookie, no
 * account). This is what lets the game client — or any other script site —
 * borrow a script from this deployment.
 *
 * The token is an HS256 JWT with `{ script_id, revision_id, exp }`, minted by
 * `POST /api/scripts/{uuid}/invite`.
 *
 * Responses
 *   200 text/plain            the Luau/Lua source of the requested revision
 *   200 application/json      same payload as an object (`?format=json`)
 *   401 (empty)               no token supplied
 *   401 {"error": …}          invalid signature / expired / malformed
 *   403 {"error": …}          token belongs to another script
 *   404 {"error": …}          unknown script or revision
 *
 * Extras that keep it useful outside the game: `?download=1` adds a
 * Content-Disposition filename, `HEAD` answers without a body, and every
 * response carries `X-Script-Id` / `X-Revision-Id` / `X-Script-Name`.
 */
export async function GET(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    const wantsJson =
      url.searchParams.get('format') === 'json' ||
      (request.headers.get('accept') ?? '').includes('application/json');

    if (!token) {
      // Same shape as the other anonymous endpoints on the platform.
      return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!isUuid(id)) throw new HttpError(404, 'Script not found');

    let claims;
    try {
      claims = await verifyContentToken(token);
    } catch (error) {
      if (error instanceof InviteError) throw new HttpError(error.status, error.message);
      throw error;
    }
    if (claims.script_id !== id) throw new HttpError(403, 'Token does not match this script');

    const data = await db();
    const script = data.scripts.find((row) => row.script_id === id);
    if (!script || script.published_at === null) throw new HttpError(404, 'Script not found');

    const release = data.releases.find((row) => row.id === claims.revision_id && row.script_id === id);
    if (!release) throw new HttpError(404, 'Revision not found');

    const headers: Record<string, string> = {
      'Cache-Control': 'private, max-age=60',
      'X-Script-Id': script.script_id,
      'X-Revision-Id': String(release.id),
      'X-Script-Name': encodeURIComponent(script.name),
      'X-Token-Expires': String(claims.exp),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Expose-Headers': 'X-Script-Id, X-Revision-Id, X-Script-Name, X-Token-Expires',
    };

    if (wantsJson) {
      return json(
        {
          script_id: script.script_id,
          revision_id: release.id,
          name: script.name,
          description: script.description,
          content: release.code,
          created_at: release.created_at,
          expires_at: new Date(claims.exp * 1000).toISOString(),
        },
        { headers },
      );
    }

    if (url.searchParams.get('download') === '1') {
      const slug = script.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'script';
      headers['Content-Disposition'] = `attachment; filename="${slug}.lua"`;
    }

    return new Response(release.code, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** HEAD — same authorisation, no body. Handy for "is this invite still alive?". */
export async function HEAD(request: Request, { params }: Ctx) {
  const response = await GET(request, { params });
  return new Response(null, { status: response.status, headers: response.headers });
}

/** The content URL is read-only. */
export async function POST() {
  return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
}
