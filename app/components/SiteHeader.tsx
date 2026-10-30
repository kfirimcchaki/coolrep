import Link from 'next/link';
import { currentUser } from '../../lib/auth';
import LogOutButton from './LogOutButton';

export default async function SiteHeader() {
  const user = await currentUser();

  return (
    <header className="header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">NT</span>
          <span>NT Scripting</span>
        </Link>

        <nav className="nav">
          <Link className="nav-link" href="/scripts">
            Scripts
          </Link>
          <Link className="nav-link" href="/import">
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
            <LogOutButton />
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
