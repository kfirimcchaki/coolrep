import {
  applySessionCookie,
  isSecureRequest,
  issueSession,
  verifyIdToken,
} from '../../../../lib/auth';
import { getClientIp, handleError, HttpError, json, rateLimit, readJson, stringParam } from '../../../../lib/http';
import { createUser, findUserByConnectSub, findUserByUsername, toPublicUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24) || 'user';
}

async function uniqueUsername(base: string): Promise<string> {
  let candidate = slugify(base);
  if (candidate.length < 3) candidate = `${candidate}user`.slice(0, 24);
  let suffix = 0;
  while (await findUserByUsername(candidate)) {
    suffix += 1;
    candidate = `${slugify(base).slice(0, 20)}${suffix}`;
    if (suffix > 999) throw new HttpError(409, 'Could not allocate a username');
  }
  return candidate;
}

/**
 * POST /api/auth/connect
 * body: { id_token, return_to? }
 *
 * The /connect page receives the id_token in the URL fragment from
 * connect.nulls.gg and exchanges it here for a first-party session.
 */
export async function POST(request: Request) {
  try {
    rateLimit(`connect:${getClientIp(request)}`, 30, 60_000);
    const body = await readJson(request);
    const idToken = stringParam(body.id_token, 'id_token', { required: true, max: 8192, trim: false })!;
    const returnTo = stringParam(body.return_to, 'return_to', { max: 512 }) ?? '/';

    const { claims, verified } = await verifyIdToken(idToken);
    const sub = claims.sub ?? claims.email!;

    let user = await findUserByConnectSub(sub);
    if (!user) {
      const username = await uniqueUsername(
        claims.preferred_username ?? claims.email?.split('@')[0] ?? claims.name ?? 'user',
      );
      user = await createUser({
        name: claims.name ?? claims.preferred_username ?? username,
        username,
        connect_sub: sub,
        email: claims.email ?? null,
      });
    }

    const session = await issueSession(user.user_id, request);
    const response = json({
      user: toPublicUser(user),
      return_to: returnTo.startsWith('/') ? returnTo : '/',
      token_verified: verified,
    });
    applySessionCookie(response, session.cookie, session.maxAge, isSecureRequest(request));
    return response;
  } catch (error) {
    return handleError(error);
  }
}
