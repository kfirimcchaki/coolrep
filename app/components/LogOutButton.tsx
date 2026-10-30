'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function LogOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      router.push('/');
      router.refresh();
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
