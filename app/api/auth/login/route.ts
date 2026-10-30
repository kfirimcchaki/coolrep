import {
  applySessionCookie,
  isSecureRequest,
  issueSession,
  verifyPassword,
} from '../../../../lib/auth';
import { getClientIp, handleError, HttpError, json, rateLimit, readJson, stringParam } from '../../../../lib/http';
import { findUserByUsername, toPublicUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

/** POST /api/auth/login  body: { username, password } */
export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    rateLimit(`login:${ip}`, 20, 60_000);

    const body = await readJson(request);
    const username = stringParam(body.username, 'username', { required: true, max: 64 })!.toLowerCase();
    const password = stringParam(body.password, 'password', { required: true, max: 128, trim: false })!;

    const user = await findUserByUsername(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      // Deliberately identical for unknown user and wrong password.
      throw new HttpError(401, 'Invalid username or password');
    }

    const session = await issueSession(user.user_id, request);
    const response = json({ user: toPublicUser(user), session_id: session.sessionId });
    applySessionCookie(response, session.cookie, session.maxAge, isSecureRequest(request));
    return response;
  } catch (error) {
    return handleError(error);
  }
}
