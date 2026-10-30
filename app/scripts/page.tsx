import ScriptsBrowser from '../components/ScriptsBrowser';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Scripts · NT Scripting' };

export default function ScriptsPage() {
  return (
    <div className="page">
      <div className="container">
        <ScriptsBrowser />
      </div>
    </div>
  );
}
