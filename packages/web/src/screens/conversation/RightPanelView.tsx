import { lazy, Suspense } from 'react';
import { Activity, ArrowLeft, X } from 'lucide-react';
import {
  findNode,
  isPending,
  type CodeRef,
  type Conversation,
  type GraphEntry,
  type Workspace,
} from '@codesplainer/shared';
import { ActivityLog } from '../../panels/ActivityLog';
import { EdgeInspector } from '../../panels/EdgeInspector';
import { NodeInspector } from '../../panels/NodeInspector';

// CodeMirror is large: load the viewer the first time code is opened.
const CodeViewer = lazy(() =>
  import('../../panels/CodeViewer').then((m) => ({ default: m.CodeViewer })),
);
import {
  askAboutCode,
  askAboutNode,
  backFromCode,
  closeRightPanel,
  expandNode,
  explainEdge,
  graphCanvasRef,
  openCode,
  openGraph,
  openInEditor,
  selectNode,
  useAppStore,
  type RightPanel,
} from '../../store';
import { IconButton, Spinner, StatusIcon } from '../../ui';

interface Props {
  conversation: Conversation;
  workspace: Workspace | undefined;
  graph: GraphEntry | undefined;
  panel: RightPanel;
}

function focusBox(nodeId: string): void {
  selectNode(nodeId);
  graphCanvasRef.current?.focusNode(nodeId);
}

export function RightPanelView({ conversation, workspace, graph, panel }: Props) {
  const selection = useAppStore((s) => s.selection);
  const theme = useAppStore((s) => s.resolvedTheme);
  const activity = useAppStore((s) => (graph ? s.activity[graph.id] : undefined));
  const multiFolder = (workspace?.folders.length ?? 1) > 1;

  return (
    <aside aria-label="Details" className="flex h-full min-h-0 flex-col bg-surface">
      {(() => {
        switch (panel.type) {
          case 'node': {
            const node =
              graph?.spec && selection.nodeId ? findNode(graph.spec, selection.nodeId) : undefined;
            if (!graph || !node) return null;
            return (
              <NodeInspector
                conversation={conversation}
                graph={graph}
                node={node}
                multiFolder={multiFolder}
                // The inspector shows "Open expansion" itself; its expand button always creates
                // a new one ("Explain & expand" / "Expand again").
                onExpand={() => void expandNode(node.id, { again: true })}
                onAsk={() => askAboutNode(node.id)}
                onOpenRef={(ref: CodeRef) =>
                  void openCode(ref, {
                    back: 'node',
                    context: { graphId: graph.id, nodeId: node.id },
                  })
                }
                onOpenInEditor={(ref: CodeRef) => void openInEditor(ref, ref.startLine)}
                onOpenGraph={openGraph}
                onSelectNode={focusBox}
                onClose={closeRightPanel}
                className="min-h-0 flex-1"
              />
            );
          }
          case 'edge': {
            const edge =
              graph?.spec && selection.edgeId
                ? graph.spec.edges.find((e) => e.id === selection.edgeId)
                : undefined;
            if (!graph || !edge) return null;
            return (
              <EdgeInspector
                graph={graph}
                edge={edge}
                onExplain={() => void explainEdge(edge.id)}
                onSelectNode={focusBox}
                onClose={closeRightPanel}
                className="min-h-0 flex-1"
              />
            );
          }
          case 'code': {
            const backLabel =
              panel.back === 'node' && graph?.spec && selection.nodeId
                ? findNode(graph.spec, selection.nodeId)?.label
                : panel.back === 'edge' && selection.edgeId
                  ? 'connection'
                  : undefined;
            return (
              <>
                {backLabel ? (
                  <div className="flex h-8 shrink-0 items-center border-b border-border px-1.5">
                    <button
                      type="button"
                      onClick={backFromCode}
                      className="inline-flex h-6 min-w-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted hover:bg-surface-2 hover:text-fg"
                    >
                      <ArrowLeft size={13} className="shrink-0" aria-hidden />
                      <span className="truncate">Back to {backLabel}</span>
                    </button>
                  </div>
                ) : null}
                <Suspense
                  fallback={
                    <div className="flex min-h-0 flex-1 items-center justify-center">
                      <Spinner />
                    </div>
                  }
                >
                  <CodeViewer
                    file={panel.file}
                    loading={panel.loading}
                    error={panel.error}
                    range={
                      panel.ref.startLine
                        ? { startLine: panel.ref.startLine, endLine: panel.ref.endLine }
                        : null
                    }
                    multiFolder={multiFolder}
                    theme={theme}
                    onAskSelection={(sel) =>
                      askAboutCode(
                        {
                          folder: panel.ref.folder,
                          path: panel.ref.path,
                          startLine: sel.startLine,
                          endLine: sel.endLine,
                        },
                        panel.context,
                      )
                    }
                    onOpenInEditor={(line) =>
                      void openInEditor(panel.ref, line ?? panel.ref.startLine)
                    }
                    onClose={closeRightPanel}
                    className="min-h-0 flex-1"
                  />
                </Suspense>
              </>
            );
          }
          case 'activity': {
            if (!graph) return null;
            return (
              <>
                <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-1.5 pl-3">
                  <Activity size={14} className="text-subtle" aria-hidden />
                  <h2 className="text-[13px] font-semibold text-fg">Activity</h2>
                  <StatusIcon status={graph.status} size={13} />
                  <IconButton
                    icon={X}
                    label="Close"
                    shortcut="Esc"
                    size="xs"
                    className="ml-auto"
                    onClick={closeRightPanel}
                  />
                </header>
                <ActivityLog
                  items={activity ?? graph.activity}
                  live={isPending(graph.status)}
                  className="min-h-0 flex-1"
                />
              </>
            );
          }
        }
      })()}
    </aside>
  );
}
