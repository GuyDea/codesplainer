/** Pure construction of conversation map nodes / edges from a conversation and its layout. */
import {
  baseName,
  graphDisplayTitle,
  parentIdOf,
  parentNodeIdOf,
  relationKind,
  relationLabel,
  type Conversation,
  type GraphEntry,
} from '@codesplainer/shared';
import type { MapLayout } from '../mapLayout';
import { thumbnailBoxes } from '../thumbnail';
import { MAP_CARD, MAP_THUMB_LEFT, MAP_THUMB_TOP, portId } from './metrics';
import type { MapFlowEdge, MapFlowNode, MapPort, MapRelation } from './types';

/** Case-insensitive match on title, question and node labels. Empty query matches everything. */
export function matchesQuery(entry: GraphEntry, query: string | undefined): boolean {
  const q = query?.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    graphDisplayTitle(entry),
    entry.question,
    ...(entry.spec?.nodes.map((n) => n.label) ?? []),
  ];
  return haystack.some((text) => text.toLowerCase().includes(q));
}

function subjectOf(entry: GraphEntry): string | undefined {
  const o = entry.origin;
  switch (o.type) {
    case 'expand':
    case 'ask-node':
      return o.nodeLabel;
    case 'ask-code':
      return baseName(o.ref.path) || o.ref.folder || undefined;
    default:
      return undefined;
  }
}

/** Card ports: one per box of this diagram that has child diagrams, placed on the thumbnail box. */
export function cardPorts(entry: GraphEntry, childNodeIds: Set<string> | undefined): MapPort[] {
  if (!entry.spec || entry.status !== 'done' || !childNodeIds?.size) return [];
  const boxes = thumbnailBoxes(entry.spec, MAP_CARD.thumbWidth, MAP_CARD.thumbHeight);
  const ports: MapPort[] = [];
  for (const nodeId of childNodeIds) {
    const box = boxes[nodeId];
    if (!box) continue;
    ports.push({
      id: portId(nodeId),
      x: Math.round((MAP_THUMB_LEFT + box.x + box.width) * 10) / 10,
      y: Math.round((MAP_THUMB_TOP + box.y + box.height / 2) * 10) / 10,
    });
  }
  return ports;
}

export function buildMapModel(
  conversation: Pick<Conversation, 'graphs'>,
  layout: MapLayout,
  currentGraphId: string | null | undefined,
  query: string | undefined,
): { nodes: MapFlowNode[]; edges: MapFlowEdge[] } {
  const graphs = conversation.graphs;
  const childNodeIds = new Map<string, Set<string>>();
  for (const g of graphs) {
    const parent = parentIdOf(g.origin);
    const nodeId = parentNodeIdOf(g.origin);
    if (!parent || !nodeId) continue;
    const set = childNodeIds.get(parent) ?? new Set<string>();
    set.add(nodeId);
    childNodeIds.set(parent, set);
  }
  const dim = new Map(graphs.map((g) => [g.id, !matchesQuery(g, query)]));
  const nodes: MapFlowNode[] = [];
  const portsOf = new Map<string, Set<string>>();
  for (const entry of graphs) {
    const rect = layout.nodes[entry.id];
    if (!rect) continue;
    const ports = cardPorts(entry, childNodeIds.get(entry.id));
    portsOf.set(entry.id, new Set(ports.map((p) => p.id)));
    nodes.push({
      id: entry.id,
      type: 'csCard',
      position: { x: rect.x, y: rect.y },
      width: rect.width,
      height: rect.height,
      draggable: false,
      selectable: false,
      data: {
        entry,
        title: graphDisplayTitle(entry),
        relation: relationLabel(entry),
        isCurrent: entry.id === currentGraphId,
        dim: dim.get(entry.id) ?? false,
        ports,
        marked: ports.map((p) => p.id.slice(2)),
      },
    });
  }
  const edges: MapFlowEdge[] = [];
  for (const entry of graphs) {
    const parentId = parentIdOf(entry.origin);
    const parentRect = parentId ? layout.nodes[parentId] : undefined;
    if (!parentId || !parentRect || !layout.nodes[entry.id]) continue;
    const nodeId = parentNodeIdOf(entry.origin);
    const handle = nodeId ? portId(nodeId) : undefined;
    const fromPort = Boolean(handle && portsOf.get(parentId)?.has(handle));
    const kind = relationKind(entry);
    const relation: MapRelation = kind === 'root' ? 'follow-up' : kind;
    edges.push({
      id: `map:${entry.id}`,
      source: parentId,
      target: entry.id,
      sourceHandle: fromPort ? handle : 'out',
      targetHandle: 'in',
      type: 'csMapEdge',
      zIndex: 1,
      selectable: false,
      focusable: false,
      data: {
        relation,
        subject: subjectOf(entry),
        exitX: parentRect.x + parentRect.width,
        fromPort,
        dim: Boolean(dim.get(entry.id) || dim.get(parentId)),
      },
    });
  }
  return { nodes, edges };
}
