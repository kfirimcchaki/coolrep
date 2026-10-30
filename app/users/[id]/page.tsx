import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { findUserById, listUserFavorites, listUserScripts } from '../../../lib/store';
import { isUuid } from '../../../lib/ids';
import ScriptCard from '../../components/ScriptCard';

export const dynamic = 'force-dynamic';

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const profile = await findUserById(id);
  if (!profile) notFound();

  const viewer = await currentUser();
  const viewerId = viewer?.user_id ?? null;
  const canInteract = Boolean(viewer);

  const [scripts, favorites] = await Promise.all([
    listUserScripts(id, viewerId),
    listUserFavorites(id, viewerId),
  ]);

  return (
    <div className="page">
      <div className="container">
        <div className="panel profile-head">
          <div className="avatar">{profile.name.slice(0, 1).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="profile-name">{profile.name}</h1>
            <div className="profile-handle">@{profile.username}</div>
          </div>
          <div className="toolbar">
            <span className="pill">{scripts.total} scripts</span>
            <span className="pill">{favorites.total} favorites</span>
            {viewerId === id ? (
              <Link className="btn btn-sm" href="/scripts/new">
                <span aria-hidden>＋</span> New script
              </Link>
            ) : null}
          </div>
        </div>

        <div className="tabs" role="tablist" aria-label="Profile sections">
          <Link className="tab active" href={`/users/${id}`} role="tab">
            Overview
          </Link>
          <Link className="tab" href={`/users/${id}/scripts`} role="tab">
            Scripts
          </Link>
        </div>

        <section className="section" style={{ marginTop: 0 }}>
          <div className="section-head">
            <h2 className="section-title">Favorites</h2>
            <span className="tiny muted">{favorites.total}</span>
          </div>
          {favorites.scripts.length === 0 ? (
            <div className="empty">No favorites yet.</div>
          ) : (
            <div className="card-grid">
              {favorites.scripts.map((script) => (
                <ScriptCard key={script.script_id} script={script} canInteract={canInteract} />
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Scripts</h2>
            <span className="tiny muted">{scripts.total}</span>
          </div>
          {scripts.scripts.length === 0 ? (
            <div className="empty">No scripts yet.</div>
          ) : (
            <div className="card-grid">
              {scripts.scripts.map((script) => (
                <ScriptCard key={script.script_id} script={script} canInteract={canInteract} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
