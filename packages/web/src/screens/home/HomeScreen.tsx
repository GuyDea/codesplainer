import { CircleAlert, RefreshCw } from 'lucide-react';
import { loadCoreData, useAppStore } from '../../store';
import { Button, EmptyState, Spinner } from '../../ui';
import { WelcomeHero } from './WelcomeHero';
import { WorkspaceGallery } from './WorkspaceGallery';

export function HomeScreen() {
  const workspaces = useAppStore((s) => s.workspaces);
  const loaded = useAppStore((s) => s.workspacesLoaded);
  const loadError = useAppStore((s) => s.loadError);

  if (!loaded) {
    if (loadError) {
      return (
        <EmptyState
          className="h-full"
          icon={CircleAlert}
          title="Couldn't load your workspaces"
          description={loadError}
          action={
            <Button icon={RefreshCw} onClick={() => void loadCoreData()}>
              Retry
            </Button>
          }
        />
      );
    }
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return workspaces.length === 0 ? <WelcomeHero /> : <WorkspaceGallery workspaces={workspaces} />;
}
