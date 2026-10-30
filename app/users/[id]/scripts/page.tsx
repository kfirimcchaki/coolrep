import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser } from '../../../../lib/auth';
import { findUserById, listUserScripts } from '../../../../lib/store';
import { isUuid } from '../../../../lib/ids';
import ScriptCard from '../../../components/ScriptCard';

export const dynamic = 'force-dynamic';

export default async function UserScriptsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const profile = await findUserById(id);
  if (!profile) notFound();

  const viewer = await currentUser();
  const scripts = await listUserScripts(id, viewer?.user_id ?? null);

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <p className="tiny muted" style={{ marginBottom: 6 }}>
              <Link href={`/users/${id}`} style={{ color: 'var(--accent)' }}>
                {profile.name}
              </Link>
            </p>
            <h1 className="page-title">Scripts</h1>
            <p className="page-sub">
              {scripts.total} script{scripts.total === 1 ? '' : 's'} by @{profile.username}
            </p>
          </div>
        </div>

        {scripts.scripts.length === 0 ? (
          <div className="empty">No scripts yet.</div>
        ) : (
          <div className="card-grid">
            {scripts.scripts.map((script) => (
              <ScriptCard key={script.script_id} script={script} canInteract={Boolean(viewer)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
