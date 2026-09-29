import { useEffect, useMemo } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import {
  findNode,
  getGraph,
  isPending,
  type Conversation,
  type Workspace,
} from '@codesplainer/shared';
import { navigate, routes, type AppView } from '../../lib/router';
import { readString, STORAGE_KEYS, writeString } from '../../lib/storage';
import {
  clearSelection,
  loadActivity,
  resetGraphUi,
  resolveCurrentGraphId,
  setState,
  useAppStore,
} from '../../store';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { CenterPane } from './CenterPane';
import { RightPanelView } from './RightPanelView';
import { Sidebar } from './Sidebar';
import { useConversationHotkeys } from './useConversationHotkeys';

interface Props {
  conversation: Conversation;
  workspace: Workspace | undefined;
  routeGraphId: string | undefined;
  view: AppView;
}

function ResizeHandle() {
  return (
    <Separator className="relative z-10 w-px shrink-0 bg-border outline-none transition-colors data-[separator=active]:bg-accent data-[separator=focus]:bg-accent data-[separator=hover]:bg-accent" />
  );
}

export function ConversationLayout({ conversation, workspace, routeGraphId, view }: Props) {
  const sidebarOpen = useAppStore((s) => s.sidebar.open);
  const rightPanel = useAppStore((s) => s.rightPanel);
  const selection = useAppStore((s) => s.selection);

  // Current diagram: route -> last viewed -> newest root. Keep the URL in sync.
  const currentGraphId = useMemo(
    () =>
      resolveCurrentGraphId(
        conversation,
        routeGraphId,
        readString(STORAGE_KEYS.lastGraph(conversation.id)),
      ),
    [conversation, routeGraphId],
  );
  const graph = currentGraphId ? getGraph(conversation, currentGraphId) : undefined;

  useEffect(() => {
    if (currentGraphId && currentGraphId !== routeGraphId) {
      navigate(
        routes.conversation(conversation.workspaceId, conversation.id, currentGraphId, view),
        {
          replace: true,
        },
      );
    }
  }, [currentGraphId, routeGraphId, conversation.workspaceId, conversation.id, view]);

  useEffect(() => {
    setState({ currentGraphId });
    if (currentGraphId) writeString(STORAGE_KEYS.lastGraph(conversation.id), currentGraphId);
    resetGraphUi();
  }, [currentGraphId, conversation.id]);

  // Live activity: full log when a pending diagram (or the activity panel) is shown.
  const pending = graph ? isPending(graph.status) : false;
  const activityOpen = rightPanel?.type === 'activity';
  useEffect(() => {
    if (graph && (pending || activityOpen)) void loadActivity(conversation.id, graph.id);
  }, [conversation.id, graph?.id, graph?.status, pending, activityOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selection that no longer exists (diagram regenerated) closes its inspector.
  useEffect(() => {
    const spec = graph?.spec;
    if (selection.nodeId && !findNode(spec, selection.nodeId)) clearSelection();
    else if (selection.edgeId && !spec?.edges.some((e) => e.id === selection.edgeId))
      clearSelection();
  }, [graph?.spec, selection.nodeId, selection.edgeId]);

  useConversationHotkeys();

  const panelIds = useMemo(
    () => [...(sidebarOpen ? ['sidebar'] : []), 'center', ...(rightPanel ? ['right'] : [])],
    [sidebarOpen, rightPanel !== null], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const layout = useDefaultLayout({ id: 'codesplainer-conversation', panelIds });

  return (
    <Group
      id="codesplainer-conversation"
      orientation="horizontal"
      defaultLayout={layout.defaultLayout}
      onLayoutChanged={layout.onLayoutChanged}
      className="h-full"
    >
      {sidebarOpen ? (
        <>
          <Panel
            id="sidebar"
            defaultSize="21"
            minSize={220}
            maxSize="40"
            style={{ overflow: 'hidden' }}
            className="flex flex-col"
          >
            <Sidebar
              conversation={conversation}
              workspace={workspace}
              currentGraphId={currentGraphId}
            />
          </Panel>
          <ResizeHandle />
        </>
      ) : null}
      <Panel id="center" minSize="30" style={{ overflow: 'hidden' }} className="flex flex-col">
        <CenterPane conversation={conversation} workspace={workspace} graph={graph} view={view} />
      </Panel>
      {rightPanel ? (
        <>
          <ResizeHandle />
          <Panel
            id="right"
            defaultSize="28"
            minSize={300}
            maxSize="60"
            style={{ overflow: 'hidden' }}
            className="flex flex-col"
          >
            <ErrorBoundary compact resetKey={rightPanel.type}>
              <RightPanelView
                conversation={conversation}
                workspace={workspace}
                graph={graph}
                panel={rightPanel}
              />
            </ErrorBoundary>
          </Panel>
        </>
      ) : null}
    </Group>
  );
}
