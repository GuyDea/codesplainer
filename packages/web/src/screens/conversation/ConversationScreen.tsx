import { useEffect } from 'react';
import { CircleAlert, MessageSquareOff, RefreshCw } from 'lucide-react';
import { navigate, routes, type AppView } from '../../lib/router';
import {
  ensureWorkspace,
  loadConversation,
  openConversation,
  openWorkspaceConversations,
  setState,
  useAppStore,
} from '../../store';
import { Button, EmptyState, Spinner } from '../../ui';
import { ConversationLayout } from './ConversationLayout';

interface Props {
  workspaceId: string;
  conversationId: string;
  graphId?: string;
  view: AppView;
}

/** #/w/:wid/c/:cid[/g/:gid][?view=map] — loads the conversation, then the 3-pane layout. */
export function ConversationScreen({ workspaceId, conversationId, graphId, view }: Props) {
  const conversation = useAppStore((s) =>
    s.conversation?.id === conversationId ? s.conversation : null,
  );
  const status = useAppStore((s) => s.conversationStatus);
  const error = useAppStore((s) => s.conversationError);
  const workspace = useAppStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const workspacesLoaded = useAppStore((s) => s.workspacesLoaded);

  useEffect(() => {
    void openConversation(conversationId);
  }, [conversationId]);

  useEffect(() => {
    openWorkspaceConversations(workspaceId).catch(() => undefined);
  }, [workspaceId]);

  useEffect(() => {
    if (workspacesLoaded && !workspace) ensureWorkspace(workspaceId).catch(() => undefined);
  }, [workspacesLoaded, workspace, workspaceId]);

  useEffect(() => {
    setState({ view });
  }, [view]);

  useEffect(
    () => () => {
      setState({ view: 'diagram', currentGraphId: null });
    },
    [],
  );

  // A link with the wrong workspace id: fix the URL.
  useEffect(() => {
    if (conversation && conversation.workspaceId !== workspaceId) {
      navigate(routes.conversation(conversation.workspaceId, conversation.id, graphId, view), {
        replace: true,
      });
    }
  }, [conversation, workspaceId, graphId, view]);

  if (!conversation) {
    if (status === 'error' && error) {
      const notFound = error.status === 404;
      return (
        <EmptyState
          className="h-full"
          icon={notFound ? MessageSquareOff : CircleAlert}
          title={notFound ? 'Conversation not found' : "Couldn't load this conversation"}
          description={notFound ? 'It may have been deleted.' : error.message}
          action={
            <div className="flex gap-2">
              {!notFound ? (
                <Button icon={RefreshCw} onClick={() => void loadConversation(conversationId)}>
                  Retry
                </Button>
              ) : null}
              <Button
                variant={notFound ? 'secondary' : 'ghost'}
                onClick={() => navigate(routes.workspace(workspaceId))}
              >
                Back to workspace
              </Button>
            </div>
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

  return (
    <ConversationLayout
      conversation={conversation}
      workspace={workspace}
      routeGraphId={graphId}
      view={view}
    />
  );
}
