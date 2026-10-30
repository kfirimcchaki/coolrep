import { redirect } from 'next/navigation';
import { currentUser } from '../../../lib/auth';
import ScriptEditor from '../../components/ScriptEditor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New script · NT Scripting' };

export default async function NewScriptPage() {
  const user = await currentUser();
  if (!user) redirect('/login?return_to=%2Fscripts%2Fnew');

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1 className="page-title">New script</h1>
            <p className="page-sub">Paste code or upload a .lua file. Ctrl/⌘+S saves.</p>
          </div>
        </div>
        <ScriptEditor mode="create" />
      </div>
    </div>
  );
}
