import { useMemo } from 'react';
import { MessageSquare, PanelLeft } from 'lucide-react';
import {
  isPending,
  pathTo,
  PROVIDER_LABELS,
  type CodeRef,
  type Conversation,
  type GraphEntry,
  type GraphSpec,
  type Workspace,
} from '@codesplainer/shared';
import { ConversationMap, GraphCanvas, Legend } from '../../graph';
// Panels are imported per file (not via the index) so the code viewer can be split out.
import { Breadcrumbs } from '../../panels/Breadcrumbs';
import { DiagramHeader } from '../../panels/DiagramHeader';
import { ErrorView } from '../../panels/ErrorView';
import { ProgressView } from '../../panels/ProgressView';
import { Suggestions } from '../../panels/Suggestions';
import { shortcutLabel } from '../../lib/platform';
import type { AppView } from '../../lib/router';
import { useStableJson } from '../../lib/useStable';
import {
  askAboutNode,
  askSuggestion,
  buildNodeChildren,
  cancelDiagram,
  conversationMapRef,
  deleteDiagram,
  expandNode,
  exportDiagram,
  graphCanvasRef,
  openCode,
  openGraph,
  openSettings,
  queuePosition,
  renameDiagram,
  retryDiagram,
  saveDiagramNote,
  selectEdge,
  selectNode,
  setDiagramStar,
  setLegendVisible,
  setSidebarOpen,
  showRawOutput,
  submitAsk,
  toggleActivityPanel,
  useAppStore,
} from '../../store';
import { ErrorBoundary } from '../../app/ErrorBoundary';
import { EmptyState, IconButton } from '../../ui';
import { StarterQuestions } from '../common/StarterQuestions';
import { ConversationAskBar } from './ConversationAskBar';

interface Props {
  conversation: Conversation;
  workspace: Workspace | undefined;
  graph: GraphEntry | undefined;
  view: AppView;
}

export function CenterPane({ conversation, workspace, graph, view }: Props) {
  const sidebarOpen = useAppStore((s) => s.sidebar.open);
  const outlineFilter = useAppStore((s) => s.outlineFilter);
  const path = useMemo(() => (graph ? pathTo(conversation, graph.id) : []), [conversation, graph]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-surface px-2">
        {!sidebarOpen ? (
          <IconButton
            icon={PanelLeft}
            label="Show sidebar"
            shortcut={shortcutLabel('mod+b')}
            size="xs"
            onClick={() => setSidebarOpen(true)}
          />
        ) : null}
        {path.length ? (
          <Breadcrumbs path={path} onOpen={openGraph} className="min-w-0 flex-1" />
        ) : (
          <span className="px-1 text-[13px] text-subtle">No diagrams yet</span>
        )}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        {view === 'map' ? (
          conversation.graphs.length ? (
            <ErrorBoundary compact resetKey={`map:${conversation.id}`}>
              <ConversationMap
                ref={conversationMapRef}
                conversation={conversation}
                currentGraphId={graph?.id ?? null}
                onOpenGraph={openGraph}
                highlightQuery={outlineFilter || undefined}
                className="h-full w-full"
              />
            </ErrorBoundary>
          ) : (
            <EmptyConversation />
          )
        ) : graph ? (
          <ErrorBoundary compact resetKey={`${graph.id}:${graph.status}:${graph.attempt}`}>
            <DiagramArea conversation={conversation} workspace={workspace} graph={graph} />
          </ErrorBoundary>
        ) : (
          <EmptyConversation />
        )}
      </div>

      <ConversationAskBar graph={graph} />
    </div>
  );
}

function EmptyConversation() {
  const busy = useAppStore((s) => s.askBusy);
  return (
    <EmptyState
      className="h-full"
      icon={MessageSquare}
      title="Ask your first question"
      action={
        <StarterQuestions
          className="max-w-xl"
          disabled={busy}
          onPick={(q) => void submitAsk(q, { type: 'new' })}
        />
      }
    />
  );
}

/** The ref's node (for "ask about these lines" context). */
function nodeIdForRef(spec: GraphSpec, ref: CodeRef): string | undefined {
  return spec.nodes.find((n) =>
    n.refs.some(
      (r) =>
        r.path === ref.path &&
        (r.folder ?? '') === (ref.folder ?? '') &&
        (r.startLine ?? 0) === (ref.startLine ?? 0),
    ),
  )?.id;
}

function DiagramArea({
  conversation,
  workspace,
  graph,
}: {
  conversation: Conversation;
  workspace: Workspace | undefined;
  graph: GraphEntry;
}) {
  const providers = useAppStore((s) => s.providers);
  const activity = useAppStore((s) => s.activity[graph.id]);
  const selection = useAppStore((s) => s.selection);
  const legendVisible = useAppStore((s) => s.legendVisible);
  const multiFolder = (workspace?.folders.length ?? 1) > 1;
  const nodeChildren = useStableJson(buildNodeChildren(conversation, graph));

  if (isPending(graph.status)) {
    const info = providers.find((p) => p.id === graph.provider);
    return (
      <ProgressView
        graph={graph}
        activity={activity ?? graph.activity}
        providerName={info?.name ?? PROVIDER_LABELS[graph.provider]}
        queuePosition={
          graph.status === 'queued' ? queuePosition(conversation, graph.id) : undefined
        }
        onCancel={() => void cancelDiagram(graph.id)}
        className="min-h-0 flex-1"
      />
    );
  }

  const spec = graph.status === 'done' ? graph.spec : undefined;
  if (!spec) {
    return (
      <ErrorView
        graph={graph}
        providers={providers}
        onRetry={(opts) => void retryDiagram(graph.id, opts)}
        onDelete={() => void deleteDiagram(graph.id)}
        onShowRaw={() => showRawOutput(graph.id)}
        onOpenSettings={() => openSettings('providers')}
        className="min-h-0 flex-1"
      />
    );
  }

  return (
    <>
      <DiagramHeader
        graph={graph}
        providers={providers}
        onRename={(title) => void renameDiagram(graph.id, title)}
        onRetry={(opts) => void retryDiagram(graph.id, opts)}
        onExport={(format) => void exportDiagram(format)}
        onToggleStar={() => void setDiagramStar(graph.id, !graph.starred)}
        onDelete={() => void deleteDiagram(graph.id)}
        onSaveNote={(note) => void saveDiagramNote(graph.id, note)}
        onShowActivity={toggleActivityPanel}
        legendVisible={legendVisible}
        onToggleLegend={() => setLegendVisible(!legendVisible)}
        // deleteDiagram() asks for confirmation itself (same dialog from every entry point).
        confirmDelete={false}
        className="shrink-0"
      />
      <div className="relative min-h-0 flex-1">
        <GraphCanvas
          ref={graphCanvasRef}
          graphId={graph.id}
          spec={spec}
          selectedNodeId={selection.nodeId}
          selectedEdgeId={selection.edgeId}
          onSelectNode={selectNode}
          onSelectEdge={selectEdge}
          onExpandNode={(nodeId) => void expandNode(nodeId)}
          onAskNode={askAboutNode}
          onOpenRef={(ref) =>
            void openCode(ref, { context: { graphId: graph.id, nodeId: nodeIdForRef(spec, ref) } })
          }
          onOpenChild={openGraph}
          nodeChildren={nodeChildren}
          multiFolder={multiFolder}
          className="h-full w-full"
        />
        {legendVisible ? <Legend spec={spec} className="absolute top-3 right-3 z-10" /> : null}
      </div>
      {spec.suggestions.length ? (
        <Suggestions
          suggestions={spec.suggestions}
          onPick={(q) => void askSuggestion(q)}
          className="shrink-0"
        />
      ) : null}
    </>
  );
}
