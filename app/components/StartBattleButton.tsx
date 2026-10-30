'use client';

import { useState } from 'react';
import { apiFetch } from '../../lib/api-client';

export default function StartBattleButton({ scriptId }: { scriptId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const response = await apiFetch(`/api/scripts/${scriptId}/share`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? `Could not create a launch link (${response.status})`);
        return;
      }
      setUrl(payload.url ?? payload.share_url ?? payload.link);
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard is not available');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
      <button className="btn btn-primary" onClick={start} disabled={busy} type="button">
        {busy ? 'Creating link…' : 'Start friendly battle'}
      </button>

      {error ? <div className="form-error" style={{ marginBottom: 0 }}>{error}</div> : null}

      {url ? (
        <div className="panel" style={{ padding: 14 }}>
          <div className="tiny muted" style={{ marginBottom: 8 }}>
            Launch link — open it to start a friendly battle with this script, or paste it into the game client.
          </div>
          <div className="copy-row">
            <input className="input" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
            <button className="btn btn-sm" type="button" onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </button>
            <a className="btn btn-sm" href={url} target="_blank" rel="noreferrer">
              Open
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
