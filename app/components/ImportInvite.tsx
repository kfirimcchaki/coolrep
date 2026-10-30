'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api-client';
import { useNav } from '../../lib/app-router';
import { decodeInvite, guessScriptName } from '../../lib/invite';

interface InspectResult {
  realm: string;
  script: string;
  bp: number[];
  name: string;
  content: string;
  content_type: string;
  bytes: number;
  script_id: string | null;
  revision_id: number | null;
  expires_at: string | null;
}

/**
 * "Borrow a script from another site".
 *
 * Reads an invite document (pretty JSON, base64 or a deep link), resolves the
 * content URL it carries and shows the source before anything is saved. If the
 * visitor is signed in, one more click copies it into their own scripts.
 */
export default function ImportInvite({ initialInvite }: { initialInvite?: string }) {
  const nav = useNav();
  const [raw, setRaw] = useState(initialInvite ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  // A local parse gives immediate feedback about malformed payloads.
  const localPreview = useMemo(() => {
    if (!raw.trim()) return null;
    try {
      return decodeInvite(raw);
    } catch {
      return null;
    }
  }, [raw]);

  const inspect = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiFetch('/api/import/inspect', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite: raw.trim() }),
      });
      const payload = (await response.json().catch(() => ({}))) as Partial<InspectResult> & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? `Could not read that invite (${response.status})`);
        return;
      }
      setResult(payload as InspectResult);
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  }, [raw]);

  const save = useCallback(async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch('/api/scripts', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${result.name || guessScriptName(result.script)}`.slice(0, 120),
          description: `Imported from ${result.script.split('?')[0]}`,
          code: result.content,
          publish: false,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { script_id?: string; error?: string };
      if (!response.ok || !payload.script_id) {
        setError(payload.error ?? `Could not import (${response.status})`);
        return;
      }
      setSaved(payload.script_id);
      nav.push(`/scripts/${payload.script_id}`);
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  }, [nav, result]);

  useEffect(() => {
    if (initialInvite?.trim()) void inspect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="panel" style={{ padding: 20 }}>
      <h2 className="section-title" style={{ fontSize: 18, marginBottom: 6 }}>
        Import from an invite
      </h2>
      <p className="small muted" style={{ marginTop: 0, marginBottom: 14 }}>
        Paste a friendly-battle invite — the <span className="mono-id">{'{ realm, script, bp }'}</span> JSON, its
        base64 form, or a <span className="mono-id">nullsbrawl://</span> link. The script source is read straight from
        the URL inside it, so scripts can be borrowed from any site that speaks this format.
      </p>

      <div className="field">
        <label className="label" htmlFor="invite-input">
          Invite
        </label>
        <textarea
          id="invite-input"
          className="input"
          rows={9}
          spellCheck={false}
          placeholder={'{\n  "realm": "experiment:scripts",\n  "script": "https://…/api/scripts/<uuid>/content?token=…",\n  "bp": [0, 0, 0, 0, 0, 0, 254, …]\n}'}
          value={raw}
          onChange={(event) => setRaw(event.target.value)}
          style={{ fontFamily: 'var(--mono, monospace)', resize: 'vertical' }}
        />
      </div>

      {localPreview ? (
        <div className="tiny muted" style={{ marginBottom: 10 }}>
          Params: realm <span className="mono-id">{localPreview.realm}</span> · bp{' '}
          <span className="mono-id">[{localPreview.bp.slice(0, 6).join(', ')}…]</span> · source{' '}
          <span className="mono-id">{new URL(localPreview.script).host}</span>
        </div>
      ) : raw.trim() ? (
        <div className="tiny muted" style={{ marginBottom: 10 }}>
          Not a recognisable invite yet — it is read again on the server, which is more forgiving.
        </div>
      ) : null}

      <div className="toolbar">
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void inspect()}
          disabled={busy || !raw.trim()}
        >
          {busy ? 'Reading…' : 'Read script'}
        </button>
        {result ? (
          <button className="btn" type="button" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Imported' : 'Copy into my scripts'}
          </button>
        ) : null}
      </div>

      {error ? <div className="form-error">{error}</div> : null}
      {saved ? <div className="form-note">Imported — opening your copy…</div> : null}

      {result ? (
        <div style={{ marginTop: 16 }}>
          <div className="meta-row" style={{ marginBottom: 10 }}>
            <span className="pill pill-success">realm {result.realm}</span>
            {result.script_id ? <span className="pill mono-id">{result.script_id}</span> : null}
            {result.revision_id ? <span className="pill">revision #{result.revision_id}</span> : null}
            <span className="pill">{result.bytes} bytes</span>
            {result.expires_at ? (
              <span className="pill">expires {new Date(result.expires_at).toLocaleString()}</span>
            ) : null}
          </div>
          <div className="tiny muted" style={{ marginBottom: 6 }}>
            source <span className="mono-id">{result.script.split('?')[0]}</span>
          </div>
          <div className="code-shell">
            <div className="code-head">
              <span>{result.name || 'script'}.lua</span>
              <span className="mono-id">{result.content.split('\n').length} lines</span>
            </div>
            <pre className="code">{result.content}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}
