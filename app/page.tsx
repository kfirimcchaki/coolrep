import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '../lib/auth';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const user = await currentUser();
  if (user) redirect('/scripts');

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
