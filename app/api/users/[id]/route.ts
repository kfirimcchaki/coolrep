import { findUserOr404 } from '../../../../lib/api-helpers';
import { handleError, json } from '../../../../lib/http';
import { toPublicUser } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/users/{uuid} → { user_id, name, username } */
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const user = await findUserOr404(id);
    return json(toPublicUser(user));
  } catch (error) {
    return handleError(error);
  }
}
