import { clearSessionCookie, isSecureRequest, rawSessionId } from '../../../../lib/auth';
import { handleError, json } from '../../../../lib/http';
import { destroySession } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

/** POST /api/auth/logout */
export async function POST(request: Request) {
  try {
    const sessionId = await rawSessionId();
    if (sessionId) await destroySession(sessionId);
    const response = json({ ok: true });
    clearSessionCookie(response, isSecureRequest(request));
    return response;
  } catch (error) {
    return handleError(error);
  }
}
