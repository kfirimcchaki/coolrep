import {
  applySessionCookie,
  hashPassword,
  isSecureRequest,
  issueSession,
} from '../../../../lib/auth';
import { handleError, HttpError, json, rateLimit, readJson, stringParam, getClientIp } from '../../../../lib/http';
import { createUser, findUserByUsername, toPublicUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;

/**
 * POST /api/auth/register
 * body: { name, username, password }  — mirrors the /register form
 * (Display Name, Username, Password).
 */
export async function POST(request: Request) {
  try {
    rateLimit(`register:${getClientIp(request)}`, 10, 60_000);
    const body = await readJson(request);
    const name = stringParam(body.name, 'name', { required: true, min: 1, max: 64 })!;
    const usernameRaw = stringParam(body.username, 'username', { required: true, min: 3, max: 24 })!;
    const password = stringParam(body.password, 'password', { required: true, min: 8, max: 128, trim: false })!;

    const username = usernameRaw.toLowerCase();
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Username may only contain a-z, 0-9 and _ (3-24 characters)');
    }
    if (await findUserByUsername(username)) {
      throw new HttpError(409, 'Username already taken');
    }

    const user = await createUser({ name, username, password_hash: hashPassword(password) });
    const session = await issueSession(user.user_id, request);
    const response = json({ user: toPublicUser(user) }, { status: 201 });
    applySessionCookie(response, session.cookie, session.maxAge, isSecureRequest(request));
    return response;
  } catch (error) {
    return handleError(error);
  }
}
