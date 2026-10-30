'use client';
import { useNav } from '../../lib/app-router';
import { useState } from 'react';
import { apiFetch } from '../../lib/api-client';

export default function RegisterForm({ returnTo }: { returnTo: string }) {
  const nav = useNav();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch('/api/auth/register', { method: 'POST', body: { name, username: username.toLowerCase(), password } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? `Registration failed (${response.status})`);
        return;
      }
      nav.push(returnTo);
      nav.refresh();
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      {error ? <div className="form-error">{error}</div> : null}
      <div className="field">
        <label className="label" htmlFor="name">
          Display Name
        </label>
        <input
          id="name"
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={64}
          required
        />
      </div>
      <div className="field">
        <label className="label" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          className="input"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          pattern="[a-zA-Z0-9_]{3,24}"
          title="3-24 characters: a-z, 0-9 and _"
          autoComplete="username"
          required
        />
        <span className="tiny muted">a-z, 0-9 and _ · 3-24 characters</span>
      </div>
      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          type="password"
          className="input"
          autoComplete="new-password"
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <span className="tiny muted">at least 8 characters</span>
      </div>
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Register'}
      </button>
    </form>
  );
}
