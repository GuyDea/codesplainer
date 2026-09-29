import type { Conversation, GraphEntry, GraphOrigin } from './conversation';

/** Pure helpers describing the discussion structure (a forest of diagrams). */

export function parentIdOf(origin: GraphOrigin): string | undefined {
  switch (origin.type) {
    case 'question':
      return undefined;
    case 'ask-code':
      return origin.parentGraphId;
    default:
      return origin.parentGraphId;
  }
}

/** The node (in the parent diagram) a diagram hangs off, if any. */
export function parentNodeIdOf(origin: GraphOrigin): string | undefined {
  switch (origin.type) {
    case 'expand':
    case 'ask-node':
      return origin.nodeId;
    case 'ask-code':
      return origin.nodeId;
    default:
      return undefined;
  }
}

export function getGraph(
  conv: Pick<Conversation, 'graphs'>,
  graphId: string | undefined,
): GraphEntry | undefined {
  return graphId ? conv.graphs.find((g) => g.id === graphId) : undefined;
}

export function parentOf(
  conv: Pick<Conversation, 'graphs'>,
  graphId: string,
): GraphEntry | undefined {
  const entry = getGraph(conv, graphId);
  return entry ? getGraph(conv, parentIdOf(entry.origin)) : undefined;
}

export function childrenOf(conv: Pick<Conversation, 'graphs'>, graphId: string): GraphEntry[] {
  return conv.graphs.filter((g) => parentIdOf(g.origin) === graphId);
}

/** Diagrams without a (still existing) parent, in creation order. */
export function rootsOf(conv: Pick<Conversation, 'graphs'>): GraphEntry[] {
  const ids = new Set(conv.graphs.map((g) => g.id));
  return conv.graphs.filter((g) => {
    const parent = parentIdOf(g.origin);
    return !parent || !ids.has(parent);
  });
}

/** Ancestors from the root down to (excluding) the given diagram. Cycle-safe. */
export function ancestorsOf(conv: Pick<Conversation, 'graphs'>, graphId: string): GraphEntry[] {
  const out: GraphEntry[] = [];
  const seen = new Set<string>([graphId]);
  let current = parentOf(conv, graphId);
  while (current && !seen.has(current.id)) {
    out.unshift(current);
    seen.add(current.id);
    current = parentOf(conv, current.id);
  }
  return out;
}

/** Root .. graph (inclusive). */
export function pathTo(conv: Pick<Conversation, 'graphs'>, graphId: string): GraphEntry[] {
  const self = getGraph(conv, graphId);
  return self ? [...ancestorsOf(conv, graphId), self] : [];
}

export function descendantsOf(conv: Pick<Conversation, 'graphs'>, graphId: string): GraphEntry[] {
  const out: GraphEntry[] = [];
  const queue = [graphId];
  const seen = new Set<string>([graphId]);
  while (queue.length) {
    const id = queue.shift() as string;
    for (const child of childrenOf(conv, id)) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      out.push(child);
      queue.push(child.id);
    }
  }
  return out;
}

export function depthOf(conv: Pick<Conversation, 'graphs'>, graphId: string): number {
  return ancestorsOf(conv, graphId).length;
}

/** Diagrams created from a specific node of a diagram (expansions and node questions). */
export function childrenOfNode(
  conv: Pick<Conversation, 'graphs'>,
  graphId: string,
  nodeId: string,
): GraphEntry[] {
  return childrenOf(conv, graphId).filter((g) => parentNodeIdOf(g.origin) === nodeId);
}

/** The latest expansion ("Explain & expand") of a node, if any. */
export function expansionOfNode(
  conv: Pick<Conversation, 'graphs'>,
  graphId: string,
  nodeId: string,
): GraphEntry | undefined {
  const list = childrenOfNode(conv, graphId, nodeId).filter((g) => g.origin.type === 'expand');
  return list[list.length - 1];
}

export interface GraphTreeNode {
  entry: GraphEntry;
  depth: number;
  children: GraphTreeNode[];
}

/** The whole conversation as a forest, children in creation order. */
export function buildTree(conv: Pick<Conversation, 'graphs'>): GraphTreeNode[] {
  const build = (entry: GraphEntry, depth: number, seen: Set<string>): GraphTreeNode => {
    seen.add(entry.id);
    return {
      entry,
      depth,
      children: childrenOf(conv, entry.id)
        .filter((c) => !seen.has(c.id))
        .map((c) => build(c, depth + 1, seen)),
    };
  };
  const seen = new Set<string>();
  return rootsOf(conv).map((r) => build(r, 0, seen));
}

/** Title to show for a diagram (its generated title, or the question while pending). */
export function graphDisplayTitle(entry: GraphEntry): string {
  return entry.spec?.title ?? (entry.question || 'Untitled');
}

/** Short relation text shown on map edges and in breadcrumbs. */
export function relationLabel(entry: GraphEntry): string {
  const o = entry.origin;
  switch (o.type) {
    case 'question':
      return 'Question';
    case 'expand':
      return `Expanded “${o.nodeLabel}”`;
    case 'ask-node':
      return `Asked about “${o.nodeLabel}”`;
    case 'ask-graph':
      return 'Follow-up';
    case 'ask-code':
      return `Asked about ${o.ref.path.split('/').pop() || o.ref.path}`;
  }
}

/** Compact relation verb for tight spaces ("expand", "ask", "follow-up", "code"). */
export function relationKind(entry: GraphEntry): 'root' | 'expand' | 'ask' | 'follow-up' | 'code' {
  switch (entry.origin.type) {
    case 'question':
      return 'root';
    case 'expand':
      return 'expand';
    case 'ask-node':
      return 'ask';
    case 'ask-graph':
      return 'follow-up';
    case 'ask-code':
      return 'code';
  }
}
