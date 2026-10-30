'use client';

import { useState } from 'react';

export default function PasswordSettings({ configured }: { configured: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/auth/password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: configured ? current : undefined,
          new_password: next,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? `Failed (${response.status})`);
        return;
      }
      setMessage(configured ? 'Password changed' : 'Password configured');
      setCurrent('');
      setNext('');
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 12 }}>
      {error ? <div className="form-error">{error}</div> : null}
      {message ? <div className="form-note">{message}</div> : null}

      {configured ? (
        <div className="field">
          <label className="label" htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            className="input"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </div>
      ) : null}

      <div className="field">
        <label className="label" htmlFor="new-password">
          {configured ? 'New password' : 'Set a password'}
        </label>
        <input
          id="new-password"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          value={next}
          onChange={(event) => setNext(event.target.value)}
          required
        />
        <span className="tiny muted">at least 8 characters</span>
      </div>

      <button className="btn btn-primary" type="submit" disabled={busy}>
        {busy ? 'Saving…' : configured ? 'Change password' : 'Set password'}
      </button>
    </form>
  );
}
