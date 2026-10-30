import { notFound, redirect } from 'next/navigation';
import { currentUser } from '../../../../lib/auth';
import { findScript } from '../../../../lib/store';
import { isUuid } from '../../../../lib/ids';
import ScriptEditor from '../../../components/ScriptEditor';

export const dynamic = 'force-dynamic';

export default async function EditScriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const user = await currentUser();
  if (!user) redirect(`/login?return_to=${encodeURIComponent(`/scripts/${id}/edit`)}`);

  const script = await findScript(id);
  if (!script) notFound();
  if (script.author_uuid !== user.user_id) {
    redirect(`/scripts/${id}`);
  }

  return (
    <div className="page">
      <div className="container">
        <div className="page-head">
          <div>
            <h1 className="page-title">{script.name}</h1>
            <p className="page-sub">
              Editing draft · saved changes are not visible until you publish a release.
            </p>
          </div>
        </div>
        <ScriptEditor
          mode="update"
          initial={{
            script_id: script.script_id,
            name: script.name,
            description: script.description ?? '',
            code: script.code,
            published_at: script.published_at,
          }}
        />
      </div>
    </div>
  );
}
