import { useEffect, useState } from 'react';
import { Link } from '../lib/app-router';
import { apiFetch, IS_STATIC, resetLocalData } from '../lib/api-client';
import type {
  PublicUser,
  ReleaseSummary,
  ScriptDetail,
  ScriptListItem,
} from '../lib/types';
import ScriptCard, { FavoriteButton } from '../app/components/ScriptCard';
import ScriptsBrowser from '../app/components/ScriptsBrowser';
import ScriptEditor from '../app/components/ScriptEditor';
import StartBattleButton from '../app/components/StartBattleButton';
import PublishButton from '../app/components/PublishButton';
import PasswordSettings from '../app/components/PasswordSettings';
import CopyField from '../app/components/CopyField';
import DownloadButton from '../app/components/DownloadButton';
import { formatDate, formatDay, useApi, useRouterState, useSession } from './lib';
import { LoadingView, NotFoundView } from './shell';

/* ------------------------------------------------------------------ */
/* Scripts browser                                                     */
/* ------------------------------------------------------------------ */

export function ScriptsView() {
  return (
    <div className="page">
      <div className="container">
        <ScriptsBrowser />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Script page                                                         */
/* ------------------------------------------------------------------ */

export function ScriptDetailView({ id }: { id: string }) {
  const { path } = useRouterState();
  const { user } = useSession();
  const script = useApi<ScriptDetail>(`/api/scripts/${id}`, [path]);
  const releases = useApi<{ releases: ReleaseSummary[] }>(`/api/scripts/${id}/releases`, [path]);
  const [code, setCode] = useState<string | null>(null);

  const isOwner = Boolean(user && script.data && user.user_id === script.data.author_uuid);

  useEffect(() => {
    if (!isOwner) {
      setCode(null);
      return;
    }
    let cancelled = false;
    apiFetch(`/api/scripts/${id}/code`).then(async (response) => {
      if (!response.ok || cancelled) return;
      const payload = (await response.json()) as { code?: string };
      if (!cancelled) setCode(payload.code ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id, isOwner, path]);

  if (script.loading) return <LoadingView />;
  if (script.error || !script.data) return <NotFoundView />;

  const detail = script.data;

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
            {user ? (
              <FavoriteButton scriptId={detail.script_id} initial={detail.is_favorite} canInteract />
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
            ) : user ? (
              <Link className="btn" href={`/users/${detail.author_uuid}`}>
                More by {detail.author_name}
              </Link>
            ) : (
              <Link
                className="btn btn-primary"
                href={`/login?return_to=${encodeURIComponent(`/scripts/${detail.script_id}`)}`}
              >
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
            <span className="tiny muted">{releases.data?.releases.length ?? 0} total</span>
          </div>

          {releases.loading ? (
            <div className="empty">Loading releases…</div>
          ) : (releases.data?.releases.length ?? 0) === 0 ? (
            <div className="empty">No releases yet.</div>
          ) : (
            <div className="list">
              {releases.data!.releases.map((release) => (
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

        {isOwner && code ? (
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
                <span className="mono-id">{code.split('\n').length} lines</span>
              </div>
              <pre className="code">{code}</pre>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function ScriptNewView() {
  const { user, loading } = useSession();
  const { navigate } = useRouterState();

  useEffect(() => {
    if (!loading && !user) navigate('/login?return_to=%2Fscripts%2Fnew', { replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) return <LoadingView />;

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1 className="page-title">New script</h1>
            <p className="page-sub">Paste code or upload a .lua file. Ctrl/⌘+S saves.</p>
          </div>
        </div>
        <ScriptEditor mode="create" />
      </div>
    </div>
  );
}

export function ScriptEditView({ id }: { id: string }) {
  const { path } = useRouterState();
  const { user, loading: sessionLoading } = useSession();
  const script = useApi<ScriptDetail>(`/api/scripts/${id}`, [path]);
  const [editorScript, setEditorScript] = useState<{
    script_id: string;
    name: string;
    description: string | null;
    code: string;
    published_at: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!script.data) return;
    let cancelled = false;
    apiFetch(`/api/scripts/${id}/code`).then(async (response) => {
      if (cancelled) return;
      if (!response.ok) {
        setError('You are not allowed to edit this script');
        return;
      }
      const payload = (await response.json()) as { code?: string };
      setEditorScript({
        script_id: script.data!.script_id,
        name: script.data!.name,
        description: script.data!.description,
        code: payload.code ?? '',
        published_at: script.data!.published_at,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [id, script.data]);

  if (sessionLoading || script.loading) return <LoadingView />;
  if (script.error) return <NotFoundView />;
  if (!user) return <LoadingView />;
  if (error) return <NotFoundView />;
  if (!editorScript) return <LoadingView />;

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1 className="page-title">{editorScript.name}</h1>
            <p className="page-sub">
              Editing draft · saved changes are not visible until you publish a release.
            </p>
          </div>
        </div>
        <ScriptEditor mode="update" initial={editorScript} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Release page                                                        */
/* ------------------------------------------------------------------ */

interface ReleaseDetail extends ReleaseSummary {
  script_id?: string;
  author_uuid?: string;
  code?: string;
}

export function ReleaseView({ id, releaseId }: { id: string; releaseId: string }) {
  const { path } = useRouterState();
  const script = useApi<ScriptDetail>(`/api/scripts/${id}`, [path]);
  const release = useApi<ReleaseDetail>(`/api/scripts/${id}/releases/${releaseId}`, [path]);

  if (script.loading || release.loading) return <LoadingView />;
  if (script.error || release.error || !script.data || !release.data) return <NotFoundView />;

  const scriptData = script.data;
  const releaseData = release.data;

  return (
    <div className="page">
      <div className="container">
        <p className="tiny muted" style={{ marginBottom: 10 }}>
          <Link href={`/scripts/${id}`} style={{ color: 'var(--accent)' }}>
            {scriptData.name}
          </Link>{' '}
          / release #{releaseData.id}
        </p>

        <div className="page-head">
          <div>
            <h1 className="page-title">Release #{releaseData.id}</h1>
            <p className="page-sub">
              {formatDate(releaseData.created_at)} · {releaseData.description ?? 'no release notes'}
            </p>
          </div>
          {releaseData.code ? (
            <DownloadButton
              filename={`${scriptData.name.replace(/[^a-z0-9._-]+/gi, '_')}-${releaseData.id}.lua`}
              content={releaseData.code}
            />
          ) : null}
        </div>

        {releaseData.code ? (
          <div className="code-shell">
            <div className="code-head">
              <span>
                {scriptData.name}.lua · release #{releaseData.id}
              </span>
              <span className="mono-id">{releaseData.code.split('\n').length} lines</span>
            </div>
            <pre className="code">{releaseData.code}</pre>
          </div>
        ) : (
          <div className="empty">
            Release source is only visible to the author.{' '}
            <Link href={`/scripts/${id}`} style={{ color: 'var(--accent)' }}>
              Back to script
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

export function UserView({ id, scriptsOnly = false }: { id: string; scriptsOnly?: boolean }) {
  const { path } = useRouterState();
  const { user } = useSession();
  const profile = useApi<PublicUser>(`/api/users/${id}`, [path]);
  const scripts = useApi<{ scripts: ScriptListItem[]; total: number }>(`/api/users/${id}/scripts`, [path]);
  const favorites = useApi<{ scripts: ScriptListItem[]; total: number }>(`/api/users/${id}/favorites`, [path]);

  if (profile.loading) return <LoadingView />;
  if (profile.error || !profile.data) return <NotFoundView />;

  const data = profile.data;
  const canInteract = Boolean(user);

  if (scriptsOnly) {
    return (
      <div className="page">
        <div className="container">
          <div className="page-head">
            <div>
              <p className="tiny muted" style={{ marginBottom: 6 }}>
                <Link href={`/users/${id}`} style={{ color: 'var(--accent)' }}>
                  {data.name}
                </Link>
              </p>
              <h1 className="page-title">Scripts</h1>
              <p className="page-sub">
                {scripts.data?.total ?? 0} script{(scripts.data?.total ?? 0) === 1 ? '' : 's'} by @{data.username}
              </p>
            </div>
          </div>
          {scripts.loading ? (
            <div className="loading-screen" style={{ minHeight: '30vh' }}>Loading...</div>
          ) : (scripts.data?.scripts.length ?? 0) === 0 ? (
            <div className="empty">No scripts yet.</div>
          ) : (
            <div className="card-grid">
              {scripts.data!.scripts.map((script) => (
                <ScriptCard key={script.script_id} script={script} canInteract={canInteract} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="container">
        <div className="panel profile-head">
          <div className="avatar">{data.name.slice(0, 1).toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 className="profile-name">{data.name}</h1>
            <div className="profile-handle">@{data.username}</div>
          </div>
          <div className="toolbar">
            <span className="pill">{scripts.data?.total ?? 0} scripts</span>
            <span className="pill">{favorites.data?.total ?? 0} favorites</span>
            {user?.user_id === id ? (
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
            <span className="tiny muted">{favorites.data?.total ?? 0}</span>
          </div>
          {favorites.loading ? (
            <div className="empty">Loading…</div>
          ) : (favorites.data?.scripts.length ?? 0) === 0 ? (
            <div className="empty">No favorites yet.</div>
          ) : (
            <div className="card-grid">
              {favorites.data!.scripts.map((script) => (
                <ScriptCard key={script.script_id} script={script} canInteract={canInteract} />
              ))}
            </div>
          )}
        </section>

        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Scripts</h2>
            <span className="tiny muted">{scripts.data?.total ?? 0}</span>
          </div>
          {scripts.loading ? (
            <div className="empty">Loading…</div>
          ) : (scripts.data?.scripts.length ?? 0) === 0 ? (
            <div className="empty">No scripts yet.</div>
          ) : (
            <div className="card-grid">
              {scripts.data!.scripts.map((script) => (
                <ScriptCard key={script.script_id} script={script} canInteract={canInteract} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

interface Me extends PublicUser {
  password_configured?: boolean;
}

export function SettingsView() {
  const { path, navigate } = useRouterState();
  const me = useApi<Me>('/api/users/me', [path]);
  const [connectSub, setConnectSub] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!me.loading && me.error) navigate('/login?return_to=%2Fsettings', { replace: true });
  }, [me.error, me.loading, navigate]);

  if (me.loading || me.error || !me.data) return <LoadingView />;

  const user = me.data;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="page-head">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-sub">
              Signed in as {user.name} · @{user.username}
            </p>
          </div>
          <Link className="btn btn-sm" href={`/users/${user.user_id}`}>
            View profile
          </Link>
        </div>

        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Sign in methods
        </h2>

        <div className="panel" style={{ padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h3 className="section-title" style={{ fontSize: 15 }}>
              Password
            </h3>
            <span className={user.password_configured ? 'pill pill-success' : 'pill pill-warn'}>
              {user.password_configured ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <PasswordSettings configured={Boolean(user.password_configured)} />
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h3 className="section-title" style={{ fontSize: 15 }}>
              Null&apos;s Connect
            </h3>
            <span className={connectSub ? 'pill pill-success' : 'pill'}>
              {connectSub ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>
            Link your Null&apos;s Connect account to sign in with a one-time code instead of a password.
          </p>
          <Link
            className="connect-btn"
            href="/connect?return_to=%2Fsettings"
            style={{ width: 'auto' }}
            onClick={() => setConnectSub((value) => value ?? 'linked')}
          >
            <span className="connect-mark">NC</span>
            Connect
          </Link>
        </div>

        {IS_STATIC ? (
          <div className="panel" style={{ padding: 20, marginTop: 14 }}>
            <h3 className="section-title" style={{ fontSize: 15, marginBottom: 6 }}>
              Local data
            </h3>
            <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>
              This deployment stores every account, script and release in your browser. Reset it to get the
              seeded demo content back.
            </p>
            {status ? <div className="form-note">{status}</div> : null}
            <button
              className="btn btn-danger"
              type="button"
              onClick={async () => {
                await resetLocalData();
                setStatus('Local data cleared — reloading…');
                window.location.href = `${window.location.origin}${window.location.pathname}`;
              }}
            >
              Reset local data
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Friendly battle launch link                                         */
/* ------------------------------------------------------------------ */

interface ShareResolution {
  token: string;
  script_id: string;
  release_id: number;
  created_at: string;
  expires_at: string | null;
  uses: number;
  script: ScriptDetail;
  release: { id: number; description: string | null; created_at: string; code: string };
}

export function BattleView({ token }: { token: string }) {
  const { path } = useRouterState();
  const share = useApi<ShareResolution>(`/api/share/${token}`, [path]);

  if (share.loading) return <LoadingView />;
  if (share.error || !share.data) return <NotFoundView />;

  const data = share.data;
  const expired = data.expires_at ? new Date(data.expires_at).getTime() < Date.now() : false;
  const deepLink = `nullsbrawl://script/${data.token}`;

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="panel script-hero">
          <span className={expired ? 'pill pill-warn' : 'pill pill-success'}>
            {expired ? 'Expired launch link' : 'Friendly battle link'}
          </span>
          <h1 className="script-title" style={{ marginTop: 14 }}>
            {data.script.name}
          </h1>
          <div className="meta-row">
            <span>Release #{data.release_id}</span>
            <span className="dot">Created {formatDate(data.created_at)}</span>
            {data.expires_at ? <span className="dot">Expires {formatDate(data.expires_at)}</span> : null}
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
                  <dd className="mono-id">{data.token}</dd>
                  <dt>Deep link</dt>
                  <dd>
                    <CopyField value={deepLink} />
                  </dd>
                  <dt>Web link</dt>
                  <dd>
                    <CopyField value={`/b/${data.token}`} />
                  </dd>
                </dl>
              </div>

              <div className="script-actions">
                <a className="btn btn-primary" href={deepLink}>
                  Open in game
                </a>
                <Link className="btn" href={`/scripts/${data.script_id}`}>
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
