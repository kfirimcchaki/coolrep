import Link from 'next/link';
import { notFound } from 'next/navigation';
import { currentUser } from '../../../../../lib/auth';
import { canView } from '../../../../../lib/api-helpers';
import { db, findScript } from '../../../../../lib/store';
import { isUuid } from '../../../../../lib/ids';
import DownloadButton from '../../../../components/DownloadButton';

export const dynamic = 'force-dynamic';

export default async function ReleasePage({
  params,
}: {
  params: Promise<{ id: string; releaseId: string }>;
}) {
  const { id, releaseId } = await params;
  if (!isUuid(id) || !Number.isInteger(Number(releaseId))) notFound();

  const viewer = await currentUser();
  const script = await findScript(id);
  if (!script || !canView(script, viewer?.user_id ?? null)) notFound();

  const data = await db();
  const release = data.releases.find((row) => row.id === Number(releaseId) && row.script_id === id);
  if (!release) notFound();

  const isOwner = viewer?.user_id === script.author_uuid;

  return (
    <div className="page">
      <div className="container">
        <p className="tiny muted" style={{ marginBottom: 10 }}>
          <Link href={`/scripts/${script.script_id}`} style={{ color: 'var(--accent)' }}>
            {script.name}
          </Link>{' '}
          / release #{release.id}
        </p>

        <div className="page-head">
          <div>
            <h1 className="page-title">Release #{release.id}</h1>
            <p className="page-sub">
              {new Date(release.created_at).toLocaleString()} ·{' '}
              {release.description ?? 'no release notes'}
            </p>
          </div>
          {isOwner ? (
            <DownloadButton
              filename={`${script.name.replace(/[^a-z0-9._-]+/gi, '_')}-${release.id}.lua`}
              content={release.code}
            />
          ) : null}
        </div>

        {isOwner ? (
          <div className="code-shell">
            <div className="code-head">
              <span>{script.name}.lua · release #{release.id}</span>
              <span className="mono-id">{release.code.split('\n').length} lines</span>
            </div>
            <pre className="code">{release.code}</pre>
          </div>
        ) : (
          <div className="empty">
            Release source is only visible to the author.{' '}
            <Link href={`/scripts/${script.script_id}`} style={{ color: 'var(--accent)' }}>
              Back to script
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
