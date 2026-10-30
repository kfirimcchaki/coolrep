import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth';
import PasswordSettings from '../components/PasswordSettings';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings · NT Scripting' };

export default async function SettingsPage() {
  const user = await currentUser();
  if (!user) redirect('/login?return_to=%2Fsettings');

  return (
    <div className="page">
      <div className="container" style={{ maxWidth: 760 }}>
        <div className="page-head">
          <div>
            <h1 className="page-title">Settings</h1>
            <p className="page-sub">
              Signed in as {user.name} · @{user.username}
            </p>
          </div>
          <Link className="btn btn-sm" href={`/users/${user.user_id}`}>
            View profile
          </Link>
        </div>

        <h2 className="section-title" style={{ marginBottom: 12 }}>
          Sign in methods
        </h2>

        <div className="panel" style={{ padding: 20, marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h3 className="section-title" style={{ fontSize: 15 }}>
              Password
            </h3>
            <span className={user.password_hash ? 'pill pill-success' : 'pill pill-warn'}>
              {user.password_hash ? 'Configured' : 'Not configured'}
            </span>
          </div>
          <PasswordSettings configured={Boolean(user.password_hash)} />
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
            <h3 className="section-title" style={{ fontSize: 15 }}>
              Null&apos;s Connect
            </h3>
            <span className={user.connect_sub ? 'pill pill-success' : 'pill'}>
              {user.connect_sub ? 'Connected' : 'Not connected'}
            </span>
          </div>
          <p className="small muted" style={{ marginTop: 4, marginBottom: 14 }}>
            Link your Null&apos;s Connect account to sign in with a one-time code instead of a password.
          </p>
          {user.connect_sub ? (
            <p className="tiny muted" style={{ margin: 0 }}>
              Subject: <span className="mono-id">{user.connect_sub}</span>
            </p>
          ) : (
            <Link className="connect-btn" href="/connect?return_to=%2Fsettings" style={{ width: 'auto' }}>
              <span className="connect-mark">NC</span>
              Connect
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
