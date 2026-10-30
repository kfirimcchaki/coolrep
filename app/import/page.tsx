import Link from 'next/link';
import ImportInvite from '../components/ImportInvite';
import { currentUser } from '../../lib/auth';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Import an invite · NT Scripting',
};

/**
 * /import — borrow a script from any site that uses the invite format
 * (`{ realm, script, bp }`). Works signed out as a read-only preview.
 */
export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const viewer = await currentUser();

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 860 }}>
        <ImportInvite initialInvite={invite} />

        <div className="panel" style={{ padding: 18, marginTop: 14 }}>
          <h3 className="section-title" style={{ fontSize: 15 }}>
            How borrowing works
          </h3>
          <div className="small muted" style={{ lineHeight: 1.8 }}>
            <div>
              1. An invite names a <span className="mono-id">script</span> URL plus the battle parameters the room was
              created with.
            </div>
            <div>
              2. That URL carries its own proof of access — an HS256 token with{' '}
              <span className="mono-id">{'{ script_id, revision_id, exp }'}</span> — so no account is needed to read
              it while it lasts.
            </div>
            <div>
              3. Reading it here copies the source into <em>your</em> scripts, where you keep full control
              {viewer ? ` (signed in as ${viewer.username})` : ' (you will need to sign in first)'}.
            </div>
          </div>
          {!viewer ? (
            <div className="toolbar" style={{ marginTop: 12 }}>
              <Link className="btn btn-primary" href="/login?return_to=%2Fimport">
                Log in to import
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
