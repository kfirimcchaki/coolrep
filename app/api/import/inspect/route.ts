import { handleError, HttpError, readJson } from '../../../../lib/http';
import { currentUser } from '../../../../lib/auth';
import { decodeInvite, guessScriptName, InviteError, validateInvite } from '../../../../lib/invite';
import { fetchScriptContent, ImportFetchError } from '../../../../lib/import-fetch';

export const dynamic = 'force-dynamic';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

function isLocalRequest(request: Request): boolean {
  if (process.env.ALLOW_LOCAL_IMPORT === '1') return true;
  const hostHeader = request.headers.get('host');
  const host = hostHeader ? hostHeader.split(':')[0] : '';
  if (LOCAL_HOSTS.has(host)) return true;
  try {
    return LOCAL_HOSTS.has(new URL(request.url).hostname);
  } catch {
    return false;
  }
}

/**
 * POST /api/import/inspect
 *
 * "Borrow a script from another site": accepts an invite document (pretty JSON,
 * base64, or a deep link) or a bare content URL, reads the source over HTTPS and
 * returns a preview. Nothing is stored — `POST /api/scripts` does that, which
 * keeps inspection usable even when signed out.
 *
 * body: { invite?: string, url?: string }
 *   200 { realm, script, bp, content, name, bytes, content_type, script_id?, revision_id? }
 *   400 / 413 / 502 { error }
 */
export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const inviteRaw = typeof body.invite === 'string' ? body.invite : undefined;
    const urlRaw = typeof body.url === 'string' ? body.url : undefined;

    if (!inviteRaw && !urlRaw) throw new HttpError(400, 'Provide an invite payload or a script URL');

    let scriptUrl: string;
    let realm = 'experiment:scripts';
    let bp: number[] | null = null;

    if (inviteRaw) {
      let invite;
      try {
        invite = decodeInvite(inviteRaw);
      } catch (error) {
        if (error instanceof InviteError) throw new HttpError(error.status === 401 ? 400 : error.status, error.message);
        throw error;
      }
      scriptUrl = invite.script;
      realm = invite.realm;
      bp = invite.bp;
    } else {
      try {
        scriptUrl = validateInvite({ realm, script: urlRaw!, bp: [] }).script;
      } catch (error) {
        if (error instanceof InviteError) throw new HttpError(400, error.message);
        throw error;
      }
    }

    // Signed-in users get their own naming hints; anonymous inspection still works.
    const viewer = await currentUser().catch(() => null);

    let fetched;
    try {
      fetched = await fetchScriptContent(scriptUrl, { allowLocal: isLocalRequest(request) });
    } catch (error) {
      if (error instanceof ImportFetchError) throw new HttpError(error.status, error.message);
      throw error;
    }

    let scriptId: string | null = null;
    let revisionId: number | null = null;
    let expiresAt: string | null = null;
    try {
      const url = new URL(fetched.finalUrl);
      const match = url.pathname.match(/\/api\/scripts\/([0-9a-f-]{36})\/content/i);
      if (match) scriptId = match[1];
      const token = url.searchParams.get('token');
      if (token && token.split('.').length === 3) {
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
        ) as { revision_id?: number; exp?: number };
        if (typeof payload.revision_id === 'number') revisionId = payload.revision_id;
        if (typeof payload.exp === 'number') expiresAt = new Date(payload.exp * 1000).toISOString();
      }
    } catch {
      /* not a tokenised URL — still importable */
    }

    return Response.json(
      {
        realm,
        script: fetched.finalUrl,
        bp: bp ?? [],
        name: guessScriptName(fetched.finalUrl),
        content: fetched.content,
        content_type: fetched.contentType,
        bytes: fetched.bytes,
        script_id: scriptId,
        revision_id: revisionId,
        expires_at: expiresAt,
        imported_by: viewer ? viewer.username : null,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
