import { currentUser } from '../../../../lib/auth';
import { handleError, HttpError, json } from '../../../../lib/http';
import { toPublicUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

/** GET /api/users/me — convenient alias used by the SPA shell. */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    return json({ ...toPublicUser(user), password_configured: Boolean(user.password_hash) });
  } catch (error) {
    return handleError(error);
  }
}
