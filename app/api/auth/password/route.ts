import { currentUser, hashPassword, verifyPassword } from '../../../../lib/auth';
import { handleError, HttpError, json, rateLimit, readJson, stringParam, getClientIp } from '../../../../lib/http';
import { transact } from '../../../../lib/store';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/password
 * body: { current_password?, new_password }
 * `current_password` is only required when a password already exists.
 */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    rateLimit(`password:${getClientIp(request)}`, 10, 60_000);

    const body = await readJson(request);
    const newPassword = stringParam(body.new_password, 'new_password', {
      required: true,
      min: 8,
      max: 128,
      trim: false,
    })!;
    const currentPassword = stringParam(body.current_password, 'current_password', {
      max: 128,
      trim: false,
    });

    if (user.password_hash) {
      if (!currentPassword) throw new HttpError(400, 'current_password is required');
      if (!verifyPassword(currentPassword, user.password_hash)) {
        throw new HttpError(403, 'Current password is incorrect');
      }
    }

    const hash = hashPassword(newPassword);
    await transact((data) => {
      const target = data.users.find((candidate) => candidate.user_id === user.user_id);
      if (target) target.password_hash = hash;
    });

    return json({ ok: true, password_configured: true });
  } catch (error) {
    return handleError(error);
  }
}

/** GET reports whether a password is configured (the /settings "Not configured" state). */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) throw new HttpError(401, 'Unauthorized');
    return json({ password_configured: Boolean(user.password_hash) });
  } catch (error) {
    return handleError(error);
  }
}
