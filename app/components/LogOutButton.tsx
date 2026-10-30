'use client';
import { useNav } from '../../lib/app-router';
import { useState } from 'react';
import { apiFetch } from '../../lib/api-client';

export default function LogOutButton() {
  const nav = useNav();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    setBusy(true);
    try {
      await apiFetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      nav.push('/');
      nav.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn btn-ghost btn-sm" onClick={logOut} disabled={busy}>
      Log out
    </button>
  );
}
