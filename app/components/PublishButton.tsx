'use client';
import { useNav } from '../../lib/app-router';
import { useState } from 'react';
import { apiFetch } from '../../lib/api-client';

export default function PublishButton({
  scriptId,
  published,
}: {
  scriptId: string;
  published: boolean;
}) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/scripts/${scriptId}/publish`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? `Publish failed (${response.status})`);
        return;
      }
      setDone(true);
      nav.refresh();
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'contents' }}>
      <button className="btn" onClick={run} disabled={busy} type="button">
        {busy ? 'Publishing…' : published ? 'Publish new release' : 'Publish'}
      </button>
      {error ? (
        <div className="form-error" style={{ marginBottom: 0 }}>
          {error}
        </div>
      ) : null}
      {done ? <span className="pill pill-success">Published</span> : null}
    </div>
  );
}
