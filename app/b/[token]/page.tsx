import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '../../../lib/store';
import CopyField from '../../components/CopyField';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Friendly battle · NT Scripting' };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await db();
  const share = data.shares.find((candidate) => candidate.token === token);
  if (!share) notFound();

  const script = data.scripts.find((candidate) => candidate.script_id === share.script_id);
  const release = data.releases.find((candidate) => candidate.id === share.release_id);
  if (!script || !release) notFound();

  const expired = share.expires_at ? new Date(share.expires_at).getTime() < Date.now() : false;
  const deepLink = `nullsbrawl://script/${share.token}`;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="panel script-hero">
          <span className={expired ? 'pill pill-warn' : 'pill pill-success'}>
            {expired ? 'Expired launch link' : 'Friendly battle link'}
          </span>
          <h1 className="script-title" style={{ marginTop: 14 }}>
            {script.name}
          </h1>
          <div className="meta-row">
            <span>Release #{release.id}</span>
            <span className="dot">Created {new Date(share.created_at).toLocaleString()}</span>
            {share.expires_at ? (
              <span className="dot">Expires {new Date(share.expires_at).toLocaleString()}</span>
            ) : null}
          </div>

          {expired ? (
            <p className="script-desc">This link is no longer valid. Ask the author for a new one.</p>
          ) : (
            <>
              <p className="script-desc">
                Open this link on the device that runs the game client to start a friendly battle with the
                script installed. Up to 10 players can join the room.
              </p>

              <div className="section" style={{ marginTop: 18 }}>
                <dl className="kv">
                  <dt>Launch token</dt>
                  <dd className="mono-id">{share.token}</dd>
                  <dt>Deep link</dt>
                  <dd>
                    <CopyField value={deepLink} />
                  </dd>
                  <dt>Web link</dt>
                  <dd>
                    <CopyField value={`/b/${share.token}`} />
                  </dd>
                </dl>
              </div>

              <div className="script-actions">
                <a className="btn btn-primary" href={deepLink}>
                  Open in game
                </a>
                <Link className="btn" href={`/scripts/${script.script_id}`}>
                  View script
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
