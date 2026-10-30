import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '../lib/app-router';
import { endSession, IS_STATIC } from '../lib/api-client';
import { apiFetch } from '../lib/api-client';
import { claimsForEmail, signIdToken } from '../lib/virtual/crypto';
import LoginForm from '../app/components/LoginForm';
import RegisterForm from '../app/components/RegisterForm';
import { BASE, useRouterState, useSession } from './lib';

/* ------------------------------------------------------------------ */
/* Chrome                                                              */
/* ------------------------------------------------------------------ */

export function Header() {
  const { user } = useSession();
  const { path, navigate } = useRouterState();
  const [busy, setBusy] = useState(false);

  async function logOut() {
    setBusy(true);
    await endSession();
    navigate('/');
    setBusy(false);
  }

  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">NT</span>
          <span>NT Scripting</span>
        </Link>

        <nav className="nav">
          <Link className={`nav-link${path.startsWith('/scripts') ? ' active' : ''}`} href="/scripts">
            Scripts
          </Link>
          <Link className={`nav-link${path.startsWith('/import') ? ' active' : ''}`} href="/import">
            Import
          </Link>
          {user ? (
            <Link className="nav-link" href={`/users/${user.user_id}`}>
              My scripts
            </Link>
          ) : null}
        </nav>

        <div className="header-spacer" />

        {user ? (
          <>
            <Link className="btn btn-sm" href="/scripts/new" title="Create script">
              <span aria-hidden>＋</span> New script
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/settings">
              Settings
            </Link>
            <Link
              href={`/users/${user.user_id}`}
              className="avatar"
              style={{ width: 34, height: 34, borderRadius: 10, fontSize: 13 }}
              title={user.username}
            >
              {user.name.slice(0, 1).toUpperCase()}
            </Link>
            <button className="btn btn-ghost btn-sm" onClick={logOut} disabled={busy} type="button">
              Log out
            </button>
          </>
        ) : (
          <>
            <Link className="btn btn-ghost btn-sm" href="/login">
              Log in
            </Link>
            <Link className="btn btn-primary btn-sm" href="/register">
              Sign up
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <span>
          NT Scripting · static build for GitHub Pages · data stays in your browser · not affiliated with
          Null&apos;s
        </span>
        <span className="mono-id">API v1 · {IS_STATIC ? 'in-browser backend' : '/api/health'}</span>
      </div>
    </footer>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <>
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

export function HomeView() {
  const { user, loading } = useSession();
  const { navigate } = useRouterState();

  useEffect(() => {
    if (!loading && user) navigate('/scripts', { replace: true });
  }, [loading, user, navigate]);

  if (loading || user) {
    return <div className="loading-screen">Loading...</div>;
  }

  return (
    <div className="landing">
      <div>
        <h1>Heeeey, scripting is here!</h1>
        <p>
          Write Lua scripts for friendly battles, publish them, and share them with the community.
          Sign in to create your first script.
        </p>
        <div className="landing-actions">
          <Link className="connect-btn" href="/connect?return_to=%2Fscripts" style={{ width: 'auto' }}>
            <span className="connect-mark">NC</span>
            Continue with Null&apos;s Connect
          </Link>
          <Link className="btn btn-lg" href="/login">
            Log in with password
          </Link>
        </div>
      </div>
    </div>
  );
}

function searchParam(name: string, fallback: string): string {
  const value = new URLSearchParams(window.location.search).get(name);
  return value && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

export function LoginView() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Log In</h1>
        <p className="auth-sub">Welcome back. Use your password or Null&apos;s Connect.</p>

        <LoginForm returnTo={searchParam('return_to', '/scripts')} />

        <div className="divider">or</div>

        <Link
          className="connect-btn"
          href={`/connect?return_to=${encodeURIComponent(searchParam('return_to', '/scripts'))}`}
        >
          <span className="connect-mark">NC</span>
          Continue with Null&apos;s Connect
        </Link>

        <p className="muted small" style={{ marginTop: 20, marginBottom: 0 }}>
          Don&apos;t have an account?{' '}
          <Link href="/register" style={{ color: 'var(--accent)' }}>
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}

export function RegisterView() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-sub">Pick a display name and a unique handle.</p>

        <RegisterForm returnTo={searchParam('return_to', '/scripts')} />

        <div className="divider">or</div>

        <Link
          className="connect-btn"
          href={`/connect?return_to=${encodeURIComponent(searchParam('return_to', '/scripts'))}`}
        >
          <span className="connect-mark">NC</span>
          Continue with Null&apos;s Connect
        </Link>

        <p className="muted small" style={{ marginTop: 20, marginBottom: 0 }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: 'var(--accent)' }}>
            Log In
          </Link>
        </p>
      </div>
    </div>
  );
}

/**
 * The static build has no server to redirect to, so `/connect` renders the
 * provider's email step inline and mints a real HS256 id_token on submit —
 * the same shape connect.nulls.gg returns in the URL fragment.
 */
export function ConnectView() {
  const { navigate } = useRouterState();
  const returnTo = searchParam('return_to', '/scripts');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.includes('@')) {
      setError('Enter a valid email address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const claims = await claimsForEmail(email, '9', window.location.origin);
      const idToken = await signIdToken(claims);
      const response = await apiFetch('/api/auth/connect', {
        method: 'POST',
        body: { id_token: idToken, return_to: returnTo },
      });
      const payload = (await response.json()) as { error?: string; return_to?: string };
      if (!response.ok) {
        setError(payload.error ?? `Sign in failed (${response.status})`);
        return;
      }
      navigate(payload.return_to ?? returnTo, { replace: true });
    } catch {
      setError('Could not complete sign in');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="connect-mark" style={{ width: 44, height: 44, borderRadius: 13, fontSize: 15, marginBottom: 16 }}>
          NC
        </div>
        <h1 className="auth-title">Null&apos;s Connect</h1>
        <p className="auth-sub">Sign in — enter your email address</p>

        {error ? <div className="form-error">{error}</div> : null}

        <form onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="connect-email">
              Email address
            </label>
            <input
              id="connect-email"
              className="input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Proceed'}
          </button>
        </form>

        <p className="tiny muted" style={{ marginTop: 18, marginBottom: 0 }}>
          Static build: this screen plays the role of the identity provider and issues a real{' '}
          <span className="mono-id">id_token</span> that the app verifies before opening a session.
        </p>
      </div>
    </div>
  );
}

export function NotFoundView({ label = '404' }: { label?: string }) {
  return (
    <div className="notfound">
      <div>
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist or has been moved.</p>
        <Link className="btn btn-primary" href="/">
          Go to homepage
        </Link>
        <p className="mono-id" style={{ marginTop: 18 }}>
          {label}
        </p>
      </div>
    </div>
  );
}

export function LoadingView() {
  return <div className="loading-screen">Loading...</div>;
}

export const SITE_BASE = BASE;
