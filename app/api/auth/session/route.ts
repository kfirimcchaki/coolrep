import { currentUser } from '../../../../lib/auth';
import { handleError, json } from '../../../../lib/http';
import { toPublicUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/session
 * Anonymous callers get `{ user: null }` (200) so the SPA can hydrate without
 * treating "logged out" as an error.
 */
export async function GET() {
  try {
    const user = await currentUser();
    return json({ user: user ? toPublicUser(user) : null });
  } catch (error) {
    return handleError(error);
  }
}
