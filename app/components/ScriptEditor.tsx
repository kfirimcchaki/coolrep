'use client';

import { Link, useNav } from '../../lib/app-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import DownloadButton from './DownloadButton';

export interface EditorScript {
  script_id: string;
  name: string;
  description: string | null;
  code: string;
  published_at: string | null;
}

const TEMPLATE = `-- Write your script here.
-- Every script needs a global tick() that runs on each game tick.

local started = false

function tick()
    if started then return end
    started = true
    log("hello from " .. server.gameMode)
end
`;

export default function ScriptEditor({
  mode,
  initial,
}: {
  mode: 'create' | 'update';
  initial?: EditorScript;
}) {
  const nav = useNav();
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [code, setCode] = useState(initial?.code ?? TEMPLATE);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'delete'>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const save = useCallback(
    async (publishAfter = false) => {
      setError(null);
      setStatus(null);
      setBusy(publishAfter ? 'publish' : 'save');
      try {
        if (!name.trim()) {
          setError('Give your script a name first');
          return;
        }

        if (mode === 'create') {
          const response = await apiFetch('/api/scripts', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description: description || null, code }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            setError(payload.error ?? `Save failed (${response.status})`);
            return;
          }
          const id = payload.script_id as string;
          if (publishAfter) {
            await apiFetch(`/api/scripts/${id}/publish`, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({}),
            });
          }
          nav.replace(`/scripts/${id}/edit`);
          return;
        }

        const id = initial!.script_id;
        const [codeResponse, metaResponse] = await Promise.all([
          apiFetch(`/api/scripts/${id}/code`, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code }),
          }),
          apiFetch(`/api/scripts/${id}`, {
            method: 'PATCH',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description: description || null }),
          }),
        ]);

        if (!codeResponse.ok || !metaResponse.ok) {
          const failure = !codeResponse.ok ? codeResponse : metaResponse;
          const payload = await failure.json().catch(() => ({}));
          setError(payload.error ?? `Save failed (${failure.status})`);
          return;
        }

        if (publishAfter) {
          const publishResponse = await apiFetch(`/api/scripts/${id}/publish`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (!publishResponse.ok) {
            const payload = await publishResponse.json().catch(() => ({}));
            setError(payload.error ?? `Publish failed (${publishResponse.status})`);
            return;
          }
          setStatus('Saved and published a new release');
        } else {
          setStatus('Saved');
        }
        nav.refresh();
      } catch {
        setError('Network error — please try again');
      } finally {
        setBusy(null);
        setTimeout(() => setStatus(null), 2600);
      }
    },
    [code, description, initial, mode, name, nav],
  );

  const remove = useCallback(async () => {
    if (mode !== 'update' || !initial) return;
    if (!window.confirm('Delete this script and all of its releases?')) return;
    setBusy('delete');
    setError(null);
    try {
      const response = await apiFetch(`/api/scripts/${initial.script_id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setError(payload.error ?? `Delete failed (${response.status})`);
        return;
      }
      nav.push('/scripts');
      nav.refresh();
    } finally {
      setBusy(null);
    }
  }, [initial, mode, nav]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 512 * 1024) {
      setError('File is larger than 512 KiB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCode(String(reader.result ?? ''));
      if (!name.trim()) setName(file.name.replace(/\.lua(u)?$/i, ''));
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  function onTab(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${code.slice(0, start)}    ${code.slice(end)}`;
    setCode(next);
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = start + 4;
    });
  }

  return (
    <div className="editor-grid">
      <div>
        <div className="code-shell">
          <div className="editor-toolbar">
            <button className="btn btn-primary btn-sm" onClick={() => save(false)} disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-sm" onClick={() => save(true)} disabled={busy !== null}>
              {busy === 'publish' ? 'Publishing…' : 'Save & publish'}
            </button>
            <button className="btn btn-sm" type="button" onClick={() => fileInput.current?.click()}>
              Upload .lua
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".lua,.luau,.txt"
              hidden
              onChange={onUpload}
            />
            <DownloadButton
              content={code}
              filename={`${(name || 'script').replace(/[^a-z0-9._-]+/gi, '_')}.lua`}
              label="Download"
            />
            <div style={{ flex: 1 }} />
            <span className="tiny muted">{code.split('\n').length} lines</span>
            {mode === 'update' ? (
              <Link className="btn btn-sm btn-ghost" href={`/scripts/${initial!.script_id}`}>
                Open page
              </Link>
            ) : null}
          </div>
          <textarea
            ref={textarea}
            className="code-editor"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={onTab}
            spellCheck={false}
            aria-label="Script source"
          />
        </div>
      </div>

      <aside className="panel" style={{ padding: 18 }}>
        <h2 className="section-title" style={{ marginBottom: 14 }}>
          {mode === 'create' ? 'New script' : 'Script details'}
        </h2>

        {error ? <div className="form-error">{error}</div> : null}
        {status ? <div className="form-note">{status}</div> : null}

        <div className="field">
          <label className="label" htmlFor="script-name">
            Name
          </label>
          <input
            id="script-name"
            className="input"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            placeholder="Among Us MODDED"
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="script-description">
            Description
          </label>
          <textarea
            id="script-description"
            className="textarea"
            value={description}
            maxLength={4000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What does your script do? Required mods, rules, maps…"
          />
        </div>

        {mode === 'update' ? (
          <>
            <dl className="kv" style={{ marginBottom: 16 }}>
              <dt>Script ID</dt>
              <dd className="mono-id">{initial!.script_id}</dd>
              <dt>Status</dt>
              <dd>{initial!.published_at ? 'Published' : 'Draft'}</dd>
            </dl>
            <button className="btn btn-danger btn-block" onClick={remove} disabled={busy !== null} type="button">
              {busy === 'delete' ? 'Deleting…' : 'Delete script'}
            </button>
          </>
        ) : (
          <p className="tiny muted">
            Saving creates a draft. Use <strong>Save &amp; publish</strong> to make it visible to everyone
            and to cut the first release.
          </p>
        )}
      </aside>
    </div>
  );
}
