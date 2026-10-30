import { currentUser } from '../../../lib/auth';
import {
  apiError,
  handleError,
  HttpError,
  intParam,
  json,
  readJson,
  stringParam,
} from '../../../lib/http';
import { listPublishedScripts, createScript, toScriptDetail, db } from '../../../lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scripts
 * The upstream service answers 401 with an empty body for anonymous callers,
 * so the browser bundle only ever calls this when a session exists.
 */
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) {
      return new Response(null, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const url = new URL(request.url);
    const limit = intParam(url.searchParams.get('limit'), 'limit', { min: 1, max: 100, fallback: 24 });
    const offset = intParam(url.searchParams.get('offset'), 'offset', { min: 0, fallback: 0 });
    const sortParam = url.searchParams.get('sort');
    const sort = sortParam === 'updated' || sortParam === 'name' ? sortParam : 'recent';

    const result = await listPublishedScripts(user.user_id, {
      limit,
      offset,
      sort,
      search: url.searchParams.get('search') ?? url.searchParams.get('q') ?? undefined,
      author: url.searchParams.get('author') ?? undefined,
    });

    return json({
      scripts: result.scripts,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/scripts
 * body: { name, description?, code?, publish? }
 */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    const body = await readJson(request);
    const name = stringParam(body.name, 'name', { required: true, max: 120 });
    const description = stringParam(body.description, 'description', { max: 4000 });
    const code = stringParam(body.code, 'code', { max: 512 * 1024, trim: false });
    const publish = body.publish === true;

    const script = await createScript({
      author_uuid: user.user_id,
      name: name!,
      description: description ?? null,
      code,
      publish,
    });
    const data = await db();
    return json(toScriptDetail(data, script, user.user_id), { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}
