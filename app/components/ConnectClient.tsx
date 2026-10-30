'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

type Status = 'waiting' | 'exchanging' | 'error';

export default function ConnectClient({
  returnTo,
  expectedState,
}: {
  returnTo: string;
  expectedState: string | null;
}) {
  const [status, setStatus] = useState<Status>('waiting');
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const params = new URLSearchParams(raw);
    const idToken = params.get('id_token') ?? params.get('access_token');
    const state = params.get('state');

    if (!idToken) return;
    if (expectedState && state && state !== expectedState) {
      setStatus('error');
      setError('The sign in response did not match this request (state mismatch).');
      return;
    }

    setStatus('exchanging');
    (async () => {
      try {
        const response = await fetch('/api/auth/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ id_token: idToken, return_to: returnTo }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          setStatus('error');
          setError(payload.error ?? `Sign in failed (${response.status})`);
          return;
        }
        const destination = typeof payload.return_to === 'string' ? payload.return_to : returnTo;
        window.location.replace(destination);
      } catch {
        setStatus('error');
        setError('Network error while completing sign in');
      }
    })();
  }, [expectedState, returnTo]);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <div className="connect-mark" style={{ width: 48, height: 48, borderRadius: 14, fontSize: 16, margin: '0 auto 16px' }}>
          NC
        </div>
        <h1 className="auth-title">Null&apos;s Connect</h1>

        {status === 'waiting' ? (
          <p className="auth-sub" style={{ marginBottom: 0 }}>
            Completing sign in…
            <br />
            <span className="tiny">
              If nothing happens,{' '}
              <Link href="/connect?restart=1" style={{ color: 'var(--accent)' }}>
                restart the flow
              </Link>
              .
            </span>
          </p>
        ) : null}

        {status === 'exchanging' ? <p className="auth-sub">Verifying your identity…</p> : null}

        {status === 'error' ? (
          <>
            <div className="form-error">{error}</div>
            <Link className="btn btn-primary btn-block" href="/connect?restart=1">
              Try again
            </Link>
          </>
        ) : null}
      </div>
    </div>
  );
}
