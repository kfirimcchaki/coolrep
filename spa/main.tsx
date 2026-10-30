import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import '../app/globals.css';
import { StaticRouterProvider, useRouterState } from './lib';
import { ConnectView, HomeView, LoginView, NotFoundView, RegisterView, Shell } from './shell';
import {
  BattleView,
  ReleaseView,
  ScriptDetailView,
  ScriptEditView,
  ScriptNewView,
  ScriptsView,
  SettingsView,
  UserView,
} from './views';

/**
 * Route table for the static build. Mirrors the Next.js App Router tree:
 *   /  /login  /register  /connect  /settings
 *   /scripts  /scripts/new  /scripts/[id]  /scripts/[id]/edit
 *   /scripts/[id]/releases/[releaseId]
 *   /users/[id]  /users/[id]/scripts  /b/[token]
 */
function Routes() {
  const { path } = useRouterState();
  const segments = path.split('/').filter(Boolean);

  useEffect(() => {
    const title = documentTitle(segments);
    document.title = title;
  }, [path, segments]);

  let view: React.ReactNode;

  if (segments.length === 0) view = <HomeView />;
  else if (segments[0] === 'login' && segments.length === 1) view = <LoginView />;
  else if (segments[0] === 'register' && segments.length === 1) view = <RegisterView />;
  else if (segments[0] === 'connect' && segments.length === 1) view = <ConnectView />;
  else if (segments[0] === 'settings' && segments.length === 1) view = <SettingsView />;
  else if (segments[0] === 'scripts' && segments.length === 1) view = <ScriptsView />;
  else if (segments[0] === 'scripts' && segments[1] === 'new') view = <ScriptNewView />;
  else if (segments[0] === 'scripts' && segments.length === 2) view = <ScriptDetailView id={segments[1]} />;
  else if (segments[0] === 'scripts' && segments[2] === 'edit' && segments.length === 3)
    view = <ScriptEditView id={segments[1]} />;
  else if (segments[0] === 'scripts' && segments[2] === 'releases' && segments.length === 4)
    view = <ReleaseView id={segments[1]} releaseId={segments[3]} />;
  else if (segments[0] === 'users' && segments.length === 2) view = <UserView id={segments[1]} />;
  else if (segments[0] === 'users' && segments[2] === 'scripts' && segments.length === 3)
    view = <UserView id={segments[1]} scriptsOnly />;
  else if (segments[0] === 'b' && segments.length === 2) view = <BattleView token={segments[1]} />;
  else view = <NotFoundView />;

  return <Shell>{view}</Shell>;
}

function documentTitle(segments: string[]): string {
  if (segments.length === 0) return 'NT Scripting';
  if (segments[0] === 'login') return 'Log In · NT Scripting';
  if (segments[0] === 'register') return 'Create Account · NT Scripting';
  if (segments[0] === 'connect') return 'Null’s Connect · NT Scripting';
  if (segments[0] === 'settings') return 'Settings · NT Scripting';
  if (segments[0] === 'scripts' && segments[1] === 'new') return 'New script · NT Scripting';
  if (segments[0] === 'scripts' && segments.length === 2) return 'Script · NT Scripting';
  if (segments[0] === 'scripts') return 'Scripts · NT Scripting';
  if (segments[0] === 'users') return 'Profile · NT Scripting';
  if (segments[0] === 'b') return 'Friendly battle · NT Scripting';
  return 'NT Scripting';
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <StaticRouterProvider>
        <Routes />
      </StaticRouterProvider>
    </StrictMode>,
  );
}
