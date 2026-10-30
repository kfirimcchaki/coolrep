import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../../lib/auth';
import RegisterForm from '../components/RegisterForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Create Account · NT Scripting' };

export default async function RegisterPage({
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
        <h1 className="auth-title">Create Account</h1>
        <p className="auth-sub">Pick a display name and a unique handle.</p>

        <RegisterForm returnTo={params.return_to ?? '/scripts'} />

        <div className="divider">or</div>

        <Link
          className="connect-btn"
          href={`/connect?return_to=${encodeURIComponent(params.return_to ?? '/scripts')}`}
        >
          <span className="connect-mark">NC</span>
          Continue with Null&apos;s Connect
        </Link>

        <p className="muted small" style={{ marginTop: 20, marginBottom: 0 }}>
          Already have an account? <Link href="/login" style={{ color: 'var(--accent)' }}>Log In</Link>
        </p>
      </div>
    </div>
  );
}
