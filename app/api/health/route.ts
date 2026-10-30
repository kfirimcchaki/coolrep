import { json } from '../../../lib/http';
import { db } from '../../../lib/store';
import { nowIso } from '../../../lib/ids';

export const dynamic = 'force-dynamic';

/** GET /api/health — liveness probe with a few counters. */
export async function GET() {
  const data = await db();
  return json({
    status: 'ok',
    time: nowIso(),
    version: 1,
    counts: {
      users: data.users.length,
      scripts: data.scripts.length,
      releases: data.releases.length,
      shares: data.shares.length,
    },
  });
}
