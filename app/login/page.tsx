import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth';
import LoginForm from '../components/LoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Log In · NT Scripting' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const user = await currentUser();
  const params = await searchParams;
  if (user) redirect(params.return_to ?? '/scripts');

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">Log In</h1>
        <p className="auth-sub">Welcome back. Use your password or Null&apos;s Connect.</p>

        <LoginForm returnTo={params.return_to ?? '/scripts'} />

        <div className="divider">or</div>

        <Link
          className="connect-btn"
          href={`/connect?return_to=${encodeURIComponent(params.return_to ?? '/scripts')}`}
        >
          <span className="connect-mark">NC</span>
          Continue with Null&apos;s Connect
        </Link>

        <p className="muted small" style={{ marginTop: 20, marginBottom: 0 }}>
          Don&apos;t have an account? <Link href="/register" style={{ color: 'var(--accent)' }}>Register</Link>
        </p>
      </div>
    </div>
  );
}
