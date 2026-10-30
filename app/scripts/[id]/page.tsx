import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import { canView } from '../../../lib/api-helpers';
import { db, findScript, listReleases, toScriptDetail } from '../../../lib/store';
import { isUuid } from '../../../lib/ids';
import { FavoriteButton } from '../../components/ScriptCard';
import StartBattleButton from '../../components/StartBattleButton';
import InviteButton from '../../components/InviteButton';
import PublishButton from '../../components/PublishButton';

export const dynamic = 'force-dynamic';

function formatDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function ScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const viewer = await currentUser();
  const script = await findScript(id);
  if (!script || !canView(script, viewer?.user_id ?? null)) notFound();

  const data = await db();
  const detail = toScriptDetail(data, script, viewer?.user_id ?? null);
  const releases = await listReleases(id);
  const isOwner = viewer?.user_id === script.author_uuid;

  return (
    <div className="page">
      <div className="container">
        <div className="panel script-hero">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h1 className="script-title">{detail.name}</h1>
              <div className="meta-row">
                <span>
                  by{' '}
                  <Link href={`/users/${detail.author_uuid}`} style={{ color: 'var(--accent)' }}>
                    {detail.author_name}
                  </Link>
                </span>
                <span className="dot">
                  {detail.published_at ? `Published ${formatDate(detail.published_at)}` : 'Draft'}
                </span>
                <span className="dot">Updated {formatDate(detail.updated_at)}</span>
                <span className="dot mono-id">{detail.script_id}</span>
              </div>
            </div>
            {viewer ? (
              <FavoriteButton
                scriptId={detail.script_id}
                initial={detail.is_favorite}
                canInteract
                className="star"
              />
            ) : null}
          </div>

          {detail.description ? <p className="script-desc">{detail.description}</p> : null}

          <div className="script-actions">
            {isOwner ? (
              <>
                <StartBattleButton scriptId={detail.script_id} />
                <Link className="btn" href={`/scripts/${detail.script_id}/edit`}>
                  Edit code
                </Link>
                <PublishButton scriptId={detail.script_id} published={Boolean(detail.published_at)} />
              </>
            ) : viewer ? (
              <Link className="btn" href={`/users/${detail.author_uuid}`}>
                More by {detail.author_name}
              </Link>
            ) : (
              <Link className="btn btn-primary" href={`/login?return_to=${encodeURIComponent(`/scripts/${detail.script_id}`)}`}>
                Log in to interact
              </Link>
            )}
          </div>

          <div className="meta-row" style={{ marginTop: 18 }}>
            <span className="pill">Map {detail.user_map_internal_id}</span>
            <span className="pill">Map ID {detail.user_map_id}</span>
            <span className={detail.published_at ? 'pill pill-success' : 'pill pill-warn'}>
              {detail.published_at ? 'Published' : 'Draft'}
            </span>
          </div>
        </div>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Releases</h2>
            <span className="tiny muted">{releases.length} total</span>
          </div>

          {releases.length === 0 ? (
            <div className="empty">No releases yet.</div>
          ) : (
            <div className="list">
              {releases.map((release) => (
                <div className="list-row" key={release.id}>
                  <span className="pill">#{release.id}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {release.description ?? <span className="muted">No release notes</span>}
                  </span>
                  <span className="tiny muted">{formatDate(release.created_at)}</span>
                  <Link className="btn btn-sm" href={`/scripts/${detail.script_id}/releases/${release.id}`}>
                    View
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        {isOwner ? (
          <section className="section">
            <div className="section-head">
              <h2 className="section-title">Draft source</h2>
              <Link className="btn btn-sm" href={`/scripts/${detail.script_id}/edit`}>
                Open editor
              </Link>
            </div>
            <div className="code-shell">
              <div className="code-head">
                <span>{detail.name}.lua</span>
                <span className="mono-id">{script.code.split('\n').length} lines</span>
              </div>
              <pre className="code">{script.code}</pre>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
