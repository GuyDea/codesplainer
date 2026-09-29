import { lazy, Suspense } from 'react';
import { useRoute, type Route } from '../lib/router';
import { GlobalDialogs } from '../dialogs/GlobalDialogs';
import { HomeScreen } from '../screens/home/HomeScreen';
import { ServerDownScreen } from '../screens/ServerDownScreen';
import { Splash } from '../screens/Splash';
import { WorkspaceScreen } from '../screens/workspace/WorkspaceScreen';
import { useAppStore } from '../store';
import { Spinner } from '../ui';
import { AppToaster } from './AppToaster';
import { CommandPalette } from './CommandPalette';
import { DropOverlay } from './DropOverlay';
import { ErrorBoundary } from './ErrorBoundary';
import {
  useConnectionLifecycle,
  useGlobalHotkeys,
  useStartupRedirect,
  useThemeSync,
  useUnknownRouteRedirect,
} from './hooks';
import { TopBar } from './TopBar';

// The conversation screen pulls in the canvas, layout engine and code editor: load it on demand.
const ConversationScreen = lazy(() =>
  import('../screens/conversation/ConversationScreen').then((m) => ({
    default: m.ConversationScreen,
  })),
);

function ScreenFallback() {
  return (
    <div className="flex h-full items-center justify-center">
      <Spinner />
    </div>
  );
}

export function App() {
  useThemeSync();
  useConnectionLifecycle();
  const route = useRoute();
  useStartupRedirect(route);
  useUnknownRouteRedirect(route);
  useGlobalHotkeys();
  const health = useAppStore((s) => s.health);
  const connectionError = useAppStore((s) => s.connectionError);

  return (
    <div className="flex h-full flex-col bg-bg text-fg">
      {health ? <TopBar route={route} /> : null}
      <main className="relative min-h-0 flex-1">
        {health ? (
          <ErrorBoundary resetKey={route.name === 'unknown' ? route.hash : JSON.stringify(route)}>
            <Suspense fallback={<ScreenFallback />}>
              <Screen route={route} />
            </Suspense>
          </ErrorBoundary>
        ) : connectionError ? (
          <ServerDownScreen />
        ) : (
          <Splash />
        )}
      </main>
      {health ? (
        <>
          <GlobalDialogs />
          <CommandPalette route={route} />
          <DropOverlay />
        </>
      ) : null}
      <AppToaster />
    </div>
  );
}

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'workspace':
      return <WorkspaceScreen key={route.workspaceId} workspaceId={route.workspaceId} />;
    case 'conversation':
      return (
        <ConversationScreen
          key={route.conversationId}
          workspaceId={route.workspaceId}
          conversationId={route.conversationId}
          graphId={route.graphId}
          view={route.view ?? 'diagram'}
        />
      );
    case 'unknown':
      return null;
  }
}
