import { useMemo } from 'react';
import { findNode, graphDisplayTitle, type GraphEntry } from '@codesplainer/shared';
import { AskBar } from '../../panels/AskBar';
import type { AskScope } from '../../panels/types';
import {
  defaultAskScope,
  effectiveAskChoice,
  setAskDetail,
  setAskModel,
  setAskProvider,
  setAskScope,
  submitAsk,
  useAppStore,
} from '../../store';

/** Bottom ask bar: new question, follow-up on the diagram, the selected box, or code. */
export function ConversationAskBar({ graph }: { graph: GraphEntry | undefined }) {
  const askScope = useAppStore((s) => s.askScope);
  const selectedNodeId = useAppStore((s) => s.selection.nodeId);
  const providers = useAppStore((s) => s.providers);
  const settings = useAppStore((s) => s.settings);
  const askPrefs = useAppStore((s) => s.askPrefs);
  const askFocus = useAppStore((s) => s.askFocus);
  const askDraft = useAppStore((s) => s.askDraft);
  const askBusy = useAppStore((s) => s.askBusy);

  const graphId = graph?.id;
  const graphStatus = graph?.status;
  const graphTitle = graph ? graphDisplayTitle(graph) : '';
  const defaultScope = useMemo(
    () => defaultAskScope(graph),
    // Only identity-relevant fields.
    [graphId, graphStatus, graphTitle], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // A node/graph scope from another diagram is stale.
  const scope: AskScope =
    askScope &&
    (askScope.type === 'new' || askScope.type === 'code' || askScope.graphId === graphId)
      ? askScope
      : defaultScope;

  const selectedNode =
    graph?.spec && selectedNodeId ? findNode(graph.spec, selectedNodeId) : undefined;
  const scopes = useMemo<AskScope[]>(() => {
    const list: AskScope[] = [{ type: 'new' }];
    if (graphId && graphStatus === 'done') list.push({ type: 'graph', graphId, title: graphTitle });
    if (graphId && selectedNode) {
      list.push({ type: 'node', graphId, nodeId: selectedNode.id, nodeLabel: selectedNode.label });
    }
    if (scope.type === 'node' && !list.some((s) => s.type === 'node')) list.push(scope);
    if (scope.type === 'code') list.push(scope);
    return list;
  }, [graphId, graphStatus, graphTitle, selectedNode, scope]);

  const choice = effectiveAskChoice(askPrefs, settings, providers);

  return (
    <div className="shrink-0 border-t border-border bg-surface px-3 py-2.5">
      <AskBar
        variant="bar"
        scope={scope}
        scopes={scopes}
        onScopeChange={setAskScope}
        providers={providers}
        provider={choice.provider}
        model={choice.model}
        detail={choice.detail}
        onProviderChange={setAskProvider}
        onModelChange={setAskModel}
        onDetailChange={setAskDetail}
        onSubmit={(question) => submitAsk(question, scope)}
        busy={askBusy}
        focusSignal={askFocus}
        draft={askDraft}
        className="mx-auto w-full max-w-3xl"
      />
    </div>
  );
}
