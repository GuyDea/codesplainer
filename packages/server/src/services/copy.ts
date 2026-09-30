/**
 * Copying conversations (duplicate, import): fresh ids for the conversation and every diagram,
 * parent links remapped, machine-specific agent sessions stripped, unfinished diagrams marked
 * cancelled, and optionally folder aliases of code refs rewritten.
 */
import {
  isPending,
  type CodeRef,
  type Conversation,
  type GraphEntry,
  type GraphOrigin,
} from '@codesplainer/shared';
import { newId } from '../ids';
import { laterIso } from '../time';

export interface CopyOptions {
  workspaceId: string;
  title?: string;
  /** Exported alias -> local alias (refs with other or no folder are left alone). */
  aliasMap?: Map<string, string>;
  /** Error text for diagrams that were still pending in the source. */
  pendingError?: string;
}

function mapRef(ref: CodeRef, aliasMap: Map<string, string> | undefined): CodeRef {
  if (!aliasMap || !ref.folder) return ref;
  const alias = aliasMap.get(ref.folder);
  return alias ? { ...ref, folder: alias } : ref;
}

function mapOrigin(
  origin: GraphOrigin,
  ids: Map<string, string>,
  aliasMap: Map<string, string> | undefined,
): GraphOrigin {
  const parent = (id: string) => ids.get(id) ?? id;
  switch (origin.type) {
    case 'question':
      return { type: 'question' };
    case 'expand':
    case 'ask-node':
      return { ...origin, parentGraphId: parent(origin.parentGraphId) };
    case 'ask-graph':
      return { ...origin, parentGraphId: parent(origin.parentGraphId) };
    case 'ask-code':
      return {
        ...origin,
        ref: mapRef(origin.ref, aliasMap),
        ...(origin.parentGraphId ? { parentGraphId: parent(origin.parentGraphId) } : {}),
      };
  }
}

/** A deep copy of `source` with new ids (see file comment). */
export function copyConversation(source: Conversation, opts: CopyOptions): Conversation {
  const ids = new Map<string, string>();
  for (const g of source.graphs) if (!ids.has(g.id)) ids.set(g.id, newId());
  const seen = new Set<string>();
  const graphs: GraphEntry[] = [];
  for (const original of source.graphs) {
    if (seen.has(original.id)) continue; // duplicate ids in a hand-edited file
    seen.add(original.id);
    const g = structuredClone(original);
    g.id = ids.get(original.id) as string;
    g.origin = mapOrigin(g.origin, ids, opts.aliasMap);
    delete g.session;
    if (isPending(g.status)) {
      g.status = 'cancelled';
      g.error = opts.pendingError ?? 'Not finished when copied.';
    }
    if (g.spec && opts.aliasMap) {
      for (const node of g.spec.nodes) node.refs = node.refs.map((r) => mapRef(r, opts.aliasMap));
      for (const edge of g.spec.edges) {
        if (edge.refs) edge.refs = edge.refs.map((r) => mapRef(r, opts.aliasMap));
      }
    }
    graphs.push(g);
  }
  return {
    id: newId(),
    title: opts.title ?? source.title,
    workspaceId: opts.workspaceId,
    createdAt: source.createdAt,
    updatedAt: laterIso(),
    graphs,
  };
}
