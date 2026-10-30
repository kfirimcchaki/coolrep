import { useCallback, useEffect, useRef, useState } from 'react';
import {
  backendMode,
  exportLocalData,
  importLocalData,
  probeBackend,
  resetLocalData,
  setStoredApiBase,
  useLocalBackend,
} from '../lib/api-client';
import { readBrowserData, writeBrowserData } from '../lib/virtual/db';
import {
  emptyDocument,
  fetchGistDocument,
  flushGistSync,
  gistShareUrl,
  gistStatus,
  parseGistId,
  pushGistDocument,
  readGistConfig,
  writeGistConfig,
} from '../lib/virtual/gist-sync';

/**
 * Settings → Backend.
 *
 * The GitHub Pages build can either keep its data in this browser (default) or
 * talk to any deployment of this repository's server build, which makes the
 * data shared between devices and users.
 */
export default function BackendPanel() {
  const [mode, setMode] = useState(backendMode());
  const [base, setBase] = useState(() => {
    try {
      return localStorage.getItem('nts.apiBase') ?? '';
    } catch {
      return '';
    }
  });
  const [probe, setProbe] = useState<{ ok: boolean; status: number; scripts?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState(() => readGistConfig()?.token ?? '');
  const [gistId, setGistId] = useState(() => readGistConfig()?.gistId ?? '');
  const [gistBusy, setGistBusy] = useState(false);
  const [shared, setShared] = useState(() => gistStatus());

  useEffect(() => {
    let cancelled = false;
    probeBackend().then((result) => {
      if (!cancelled) setProbe(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const candidate = base.trim().replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(candidate)) {
        setError('Enter a full URL, e.g. https://my-server.onrender.com');
        return;
      }
      const health = await probeBackend(candidate);
      if (!health.ok) {
        setError(`No API answered at ${candidate}/api/health (status ${health.status || 'network error'})`);
        return;
      }
      setStoredApiBase(candidate);
      setMessage(`Connected to ${candidate} — reloading with the shared database…`);
      setTimeout(() => window.location.reload(), 700);
    } finally {
      setBusy(false);
    }
  }, [base]);

  const goLocal = useCallback(() => {
    useLocalBackend();
    setMessage('Back to the in-browser database — reloading…');
    setTimeout(() => window.location.reload(), 600);
  }, []);

  const download = useCallback(async () => {
    setError(null);
    try {
      const json = await exportLocalData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `nt-scripting-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Export failed');
    }
  }, []);

  const restore = useCallback(async (file: File) => {
    setError(null);
    setMessage(null);
    try {
      const text = await file.text();
      const result = await importLocalData(text);
      setMessage(`Restored ${result.scripts} scripts and ${result.users} accounts — reloading…`);
      setTimeout(() => window.location.reload(), 700);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed');
    }
  }, []);

  return (
    <div className="panel" style={{ padding: 20, marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h3 className="section-title" style={{ fontSize: 15 }}>
          Backend
        </h3>
        <span className={mode === 'remote' ? 'pill pill-success' : 'pill'}>
          {mode === 'remote' ? 'Shared server' : 'This browser'}
        </span>
        {probe ? (
          <span className={probe.ok ? 'pill pill-success' : 'pill pill-warn'}>
            {probe.ok ? `API online · ${probe.scripts ?? 0} scripts` : 'API offline'}
          </span>
        ) : null}
      </div>

      <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>
        GitHub Pages has no database of its own, so by default everything lives in this browser
        (IndexedDB). Point the site at any deployment of this repository&apos;s server build and the
        same accounts, scripts and releases work on every device.
      </p>

      {message ? <div className="form-note">{message}</div> : null}
      {error ? <div className="form-error">{error}</div> : null}

      <div className="field">
        <label className="label" htmlFor="api-base">
          Server URL
        </label>
        <div className="copy-row">
          <input
            id="api-base"
            className="input"
            placeholder="https://nt-scripting.onrender.com"
            value={base}
            onChange={(event) => setBase(event.target.value)}
            spellCheck={false}
          />
          <button className="btn btn-primary" type="button" onClick={connect} disabled={busy}>
            {busy ? 'Checking…' : 'Use server'}
          </button>
        </div>
        <span className="tiny muted">
          The server must allow this origin (the bundled server allows <span className="mono-id">*.github.io</span>
          {' '}and <span className="mono-id">CORS_ORIGINS</span>).
        </span>
      </div>

      <div className="toolbar" style={{ marginBottom: 18 }}>
        <button className="btn btn-sm" type="button" onClick={goLocal} disabled={mode === 'local'}>
          Use this browser
        </button>
        <button className="btn btn-sm" type="button" onClick={download}>
          Export backup
        </button>
        <button className="btn btn-sm" type="button" onClick={() => fileInput.current?.click()}>
          Import backup
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void restore(file);
            event.target.value = '';
          }}
        />
        <button
          className="btn btn-sm btn-danger"
          type="button"
          onClick={async () => {
            if (!window.confirm('Delete every account and script stored in this browser?')) return;
            await resetLocalData();
            window.location.reload();
          }}
        >
          Reset local data
        </button>
      </div>


      <div className="divider" style={{ margin: '18px 0' }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h3 className="section-title" style={{ fontSize: 15 }}>
          Shared database (no server needed)
        </h3>
        <span className={shared.configured ? 'pill pill-success' : 'pill'}>
          {shared.configured ? 'Gist synced' : 'Not linked'}
        </span>
        {shared.lastPushAt ? (
          <span className="pill">Synced {new Date(shared.lastPushAt).toLocaleTimeString()}</span>
        ) : null}
      </div>

      <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>
        Link a secret GitHub Gist and this browser keeps the whole database there instead of only
        in this profile — same accounts, scripts and releases on every device, still with zero
        infrastructure. The token stays in this browser and only needs the <span className="mono-id">gist</span> scope.
      </p>

      {shared.lastError ? <div className="form-error">{shared.lastError}</div> : null}

      <div className="field">
        <label className="label" htmlFor="gist-token">
          GitHub token (<span className="mono-id">gist</span> scope)
        </label>
        <input
          id="gist-token"
          className="input"
          type="password"
          placeholder="ghp_…"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="gist-id">
          Gist id or URL (leave empty to create one)
        </label>
        <input
          id="gist-id"
          className="input"
          placeholder="1f2e3d4c5b… or https://gist.github.com/you/1f2e…"
          value={gistId}
          onChange={(event) => setGistId(event.target.value)}
          spellCheck={false}
        />
      </div>

      <div className="toolbar" style={{ marginBottom: 10 }}>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={gistBusy}
          onClick={async () => {
            setError(null);
            setMessage(null);
            const trimmed = token.trim();
            if (!trimmed) {
              setError('Paste a GitHub token with the gist scope first');
              return;
            }
            const target = gistId.trim() ? parseGistId(gistId) : null;
            if (gistId.trim() && !target) {
              setError('That does not look like a gist id or gist URL');
              return;
            }
            setGistBusy(true);
            try {
              const data = (await readBrowserData()) ?? emptyDocument();
              const config = await pushGistDocument({ token: trimmed, gistId: target }, data);
              writeGistConfig(config);
              setGistId(config.gistId ?? '');
              setShared(gistStatus());
              setMessage(`Shared database linked — open this link on any device: ${gistShareUrl(config.gistId ?? '')}`);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not reach GitHub');
            } finally {
              setGistBusy(false);
            }
          }}
        >
          {gistBusy ? 'Talking to GitHub…' : gistId.trim() ? 'Link this gist' : 'Create shared gist'}
        </button>

        <button
          className="btn btn-sm"
          type="button"
          disabled={gistBusy || !gistId.trim()}
          onClick={async () => {
            setError(null);
            setMessage(null);
            const target = parseGistId(gistId);
            if (!target) {
              setError('That does not look like a gist id or gist URL');
              return;
            }
            setGistBusy(true);
            try {
              const data = await fetchGistDocument(target, token.trim() || undefined);
              if (!data) {
                setError('That gist has no NT Scripting database in it');
                return;
              }
              await writeBrowserData(data);
              setMessage(`Pulled ${data.scripts.length} scripts from the gist — reloading…`);
              setTimeout(() => window.location.reload(), 700);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Could not reach GitHub');
            } finally {
              setGistBusy(false);
            }
          }}
        >
          Pull from gist
        </button>

        <button
          className="btn btn-sm"
          type="button"
          disabled={!shared.configured}
          onClick={() => {
            flushGistSync();
            setShared(gistStatus());
            setMessage('Queue flushed — GitHub has the newest copy');
          }}
        >
          Sync now
        </button>

        <button
          className="btn btn-sm btn-danger"
          type="button"
          disabled={!shared.configured}
          onClick={() => {
            if (!window.confirm('Stop syncing with this gist? Your local copy stays intact.')) return;
            writeGistConfig(null);
            setShared(gistStatus());
            setMessage('Gist sync disabled for this browser');
          }}
        >
          Unlink
        </button>
      </div>

      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          How the gist transport works
        </summary>
        <div className="small" style={{ marginTop: 10, lineHeight: 1.7 }}>
          <div>
            The page keeps writing to IndexedDB first, then mirrors the JSON document to{' '}
            <span className="mono-id">api.github.com/gists</span> (create the first time, patch afterwards).
          </div>
          <div>
            Other devices open <span className="mono-id">?gist=&lt;id&gt;</span> (or paste the id above) and boot
            from the same document; with a token they write back to it too.
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Offline edits are queued and flushed on reconnect. Anonymous reads of a public gist are
            rate-limited by GitHub (60/hour) — a token raises that to 5 000/hour.
          </div>
        </div>
      </details>

      <details>
        <summary className="small muted" style={{ cursor: 'pointer' }}>
          Deploy your own backend (2 minutes)
        </summary>
        <div className="small" style={{ marginTop: 10, lineHeight: 1.7 }}>
          <div>
            1. Deploy this repository to Render / Railway / Fly / any Node host (configs are in{' '}
            <span className="mono-id">deploy/</span>).
          </div>
          <div>
            2. Set <span className="mono-id">APP_URL</span> to the Pages URL and{' '}
            <span className="mono-id">CORS_ORIGINS</span> to the same origin.
          </div>
          <div>
            3. Paste its URL above and press <strong>Use server</strong>.
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            Docker alternative: <span className="mono-id">docker run -p 3000:3000 -v $PWD/.data:/app/.data nt-scripting</span>
          </div>
        </div>
      </details>
    </div>
  );
}
