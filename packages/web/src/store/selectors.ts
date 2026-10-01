/** Pure derived data (no React, no store access) + a few store hooks. */
import {
  childrenOf,
  childrenOfNode,
  getGraph,
  graphDisplayTitle,
  parentIdOf,
  PROVIDER_IDS,
  PROVIDER_LABELS,
  rootsOf,
  type Conversation,
  type DetailLevel,
  type GraphEntry,
  type ProviderId,
  type ProviderInfo,
  type Settings,
  type Workspace,
} from '@codesplainer/shared';
import type { NodeChildInfo } from '../graph/types';
import type { AskScope } from '../panels/types';
import type { AskPrefs } from './types';

export function providerName(providers: ProviderInfo[], id: ProviderId): string {
  return providers.find((p) => p.id === id)?.name ?? PROVIDER_LABELS[id] ?? id;
}

export function isProviderReady(info: ProviderInfo | undefined): boolean {
  return Boolean(info && info.available && info.enabled);
}

export interface AskChoice {
  provider: ProviderId;
  model: string;
  detail: DetailLevel;
  /** '' = the provider setting. */
  effort: string;
  fast: boolean;
}

/**
 * Provider/model/detail/effort/fast used for the next question: the remembered choice, else settings. When
 * that provider is known to be unavailable, fall back to the first ready one (real agents
 * before the offline demo) so a first question does not fail on a missing CLI.
 */
export function effectiveAskChoice(
  prefs: AskPrefs,
  settings: Settings | null,
  providers: ProviderInfo[] = [],
): AskChoice {
  let provider = prefs.provider ?? settings?.defaultProvider ?? 'kiro';
  const info = providers.find((p) => p.id === provider);
  if (info && !isProviderReady(info)) {
    const ready = PROVIDER_IDS.map((id) => providers.find((p) => p.id === id)).filter(
      (p): p is ProviderInfo => isProviderReady(p),
    );
    const fallback = ready.find((p) => p.id !== 'mock') ?? ready[0];
    if (fallback) provider = fallback.id;
  }
  return {
    provider,
    model: prefs.models[provider] ?? '',
    detail: prefs.detail ?? settings?.detail ?? 'balanced',
    effort: prefs.efforts?.[provider] ?? '',
    fast: prefs.fast?.[provider] ?? settings?.providers[provider].fast ?? false,
  };
}

/**
 * Diagram to show: the one in the route if it exists, else the last viewed one (if it still
 * exists), else the newest root question.
 */
export function resolveCurrentGraphId(
  conversation: Pick<Conversation, 'graphs'>,
  routeGraphId: string | undefined,
  lastViewedId: string | null,
): string | null {
  if (routeGraphId && getGraph(conversation, routeGraphId)) return routeGraphId;
  if (lastViewedId && getGraph(conversation, lastViewedId)) return lastViewedId;
  const roots = rootsOf(conversation);
  return (
    roots[roots.length - 1]?.id ?? conversation.graphs[conversation.graphs.length - 1]?.id ?? null
  );
}

/** Child diagrams per node of a diagram (for badges on the canvas). */
export function buildNodeChildren(
  conversation: Pick<Conversation, 'graphs'>,
  graph: GraphEntry,
): Record<string, NodeChildInfo[]> {
  const out: Record<string, NodeChildInfo[]> = {};
  for (const node of graph.spec?.nodes ?? []) {
    const list = childrenOfNode(conversation, graph.id, node.id)
      .filter(
        (g): g is GraphEntry & { origin: { type: NodeChildInfo['type'] } } =>
          g.origin.type === 'expand' ||
          g.origin.type === 'ask-node' ||
          g.origin.type === 'ask-code',
      )
      .map((g) => ({
        graphId: g.id,
        type: g.origin.type,
        status: g.status,
        title: graphDisplayTitle(g),
      }));
    if (list.length) out[node.id] = list;
  }
  return out;
}

/** Diagrams sharing the same parent (or all roots), creation order. */
export function siblingsOf(
  conversation: Pick<Conversation, 'graphs'>,
  graphId: string,
): GraphEntry[] {
  const graph = getGraph(conversation, graphId);
  if (!graph) return [];
  const parentId = parentIdOf(graph.origin);
  if (parentId && getGraph(conversation, parentId)) return childrenOf(conversation, parentId);
  return rootsOf(conversation);
}

export function siblingGraphId(
  conversation: Pick<Conversation, 'graphs'>,
  graphId: string,
  delta: -1 | 1,
): string | null {
  const siblings = siblingsOf(conversation, graphId);
  const index = siblings.findIndex((g) => g.id === graphId);
  if (index < 0) return null;
  return siblings[index + delta]?.id ?? null;
}

export function parentGraphId(
  conversation: Pick<Conversation, 'graphs'>,
  graphId: string,
): string | null {
  const graph = getGraph(conversation, graphId);
  if (!graph) return null;
  const parentId = parentIdOf(graph.origin);
  return parentId && getGraph(conversation, parentId) ? parentId : null;
}

/** 1-based position among queued diagrams of the conversation (best effort; queue is global). */
export function queuePosition(
  conversation: Pick<Conversation, 'graphs'>,
  graphId: string,
): number | undefined {
  const queued = conversation.graphs
    .filter((g) => g.status === 'queued')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const index = queued.findIndex((g) => g.id === graphId);
  return index >= 0 ? index + 1 : undefined;
}

/** Default ask scope for a diagram: follow-up about it when it is done, else a new question. */
export function defaultAskScope(graph: GraphEntry | undefined): AskScope {
  if (graph && graph.status === 'done') {
    return { type: 'graph', graphId: graph.id, title: graphDisplayTitle(graph) };
  }
  return { type: 'new' };
}

export function sortWorkspacesRecent(workspaces: Workspace[]): Workspace[] {
  const stamp = (w: Workspace) => w.lastOpenedAt ?? w.updatedAt ?? w.createdAt;
  return workspaces
    .slice()
    .sort((a, b) => (stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0));
}

/** Folder alias for a ref (single-folder workspaces may omit it). */
export function refFolder(
  workspace: Pick<Workspace, 'folders'> | undefined,
  folder?: string,
): string {
  return folder || workspace?.folders[0]?.alias || '';
}
