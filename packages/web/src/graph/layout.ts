/**
 * Layered layout of a diagram with ELK: text-sized boxes, groups as compound nodes, orthogonal
 * edge routes and edge-label positions. Pure and async (no React); results are memoized in an
 * LRU keyed by a hash of everything that influences geometry.
 */
import type { ElkExtendedEdge, ElkNode, LayoutOptions } from 'elkjs/lib/elk-api';
import {
  defaultDirection,
  type GraphDirection,
  type GraphEdge,
  type GraphNode,
  type GraphSpec,
} from '@codesplainer/shared';
import { hashString, LruCache } from './cache';
import { getElk } from './elk';
import { countLines, measureText, measurementMode, type FontSpec } from './measure';
import { refChipText } from './refs';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Absolute box of a diagram node. */
export interface NodeBox extends Rect {
  id: string;
  /** Lines the label wraps into (1-2). */
  labelLines: number;
  /** Lines of detail text (0-2). */
  detailLines: number;
  hasChip: boolean;
}

/** Absolute box of a group (compound node). */
export interface GroupBox extends Rect {
  id: string;
  label: string;
}

/** Absolute polyline of an edge: start, bend points, end. `label` is the label box, if any. */
export interface EdgeRoute {
  id: string;
  source: string;
  target: string;
  points: Point[];
  label?: Rect;
}

export interface GraphLayout {
  key: string;
  /** `elk` for real layouts, `quick` for the synchronous fallback. */
  engine: 'elk' | 'quick';
  direction: GraphDirection;
  width: number;
  height: number;
  nodes: Record<string, NodeBox>;
  groups: GroupBox[];
  edges: Record<string, EdgeRoute>;
}

export interface LayoutOptionsInput {
  /** Override the direction (default: spec.direction or by diagram kind). */
  direction?: GraphDirection;
  /** Ref chips include the folder alias (affects box widths). */
  multiFolder?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Box metrics. DiagramNode renders with exactly these numbers so text fits the computed boxes.
// ---------------------------------------------------------------------------------------------

export const NODE_METRICS = {
  minWidth: 152,
  maxWidth: 260,
  /** Max width in LR layouts (width is the scarce axis there). */
  maxWidthLR: 224,
  minHeight: 46,
  padX: 12,
  padY: 10,
  iconSize: 26,
  iconGap: 10,
  label: { size: 13, weight: 600 } satisfies FontSpec,
  labelLine: 18,
  detail: { size: 11.5, weight: 400 } satisfies FontSpec,
  detailLine: 15,
  detailGap: 2,
  chip: { size: 10.5, weight: 500, family: 'mono' } satisfies FontSpec,
  chipHeight: 18,
  chipGap: 6,
  chipPadX: 6,
  chipIcon: 11,
  chipIconGap: 4,
  /** Extra room so small measuring differences never cause an unexpected wrap. */
  slack: 4,
  border: 1,
} as const;

export const EDGE_LABEL_METRICS = {
  font: { size: 11, weight: 500 } satisfies FontSpec,
  height: 20,
  padX: 7,
  step: 15,
  stepFont: { size: 9.5, weight: 700 } satisfies FontSpec,
  stepGap: 5,
  maxText: 150,
} as const;

/** Horizontal space around the text column: padding, icon, gap and the 1px borders. */
const TEXT_CHROME =
  NODE_METRICS.padX * 2 + NODE_METRICS.iconSize + NODE_METRICS.iconGap + NODE_METRICS.border * 2;

export interface NodeSize {
  width: number;
  height: number;
  labelLines: number;
  detailLines: number;
  hasChip: boolean;
}

/** Text of the ref chip of a node (first ref + "+N"), or undefined. */
export function nodeChipText(node: GraphNode, multiFolder = false): string | undefined {
  const first = node.refs[0];
  if (!first) return undefined;
  const more = node.refs.length > 1 ? ` +${node.refs.length - 1}` : '';
  return `${refChipText(first, multiFolder)}${more}`;
}

/** Box size of a node, estimated from its text. */
export function measureNode(
  node: Pick<GraphNode, 'label' | 'detail' | 'refs'>,
  multiFolder = false,
  maxWidth: number = NODE_METRICS.maxWidth,
  /** `narrow`: width is the scarce axis (LR layouts) - wrap details rather than widen. */
  prefer: 'wide' | 'narrow' = 'wide',
): NodeSize {
  const M = NODE_METRICS;
  const minText = M.minWidth - TEXT_CHROME;
  const maxText = Math.max(minText, maxWidth - TEXT_CHROME);
  const chip = nodeChipText(node as GraphNode, multiFolder);
  const chipWidth = chip
    ? M.chipPadX * 2 + M.chipIcon + M.chipIconGap + measureText(chip, M.chip) + 2
    : 0;
  const labelWidth = measureText(node.label, M.label) + M.slack;
  const fits = (text: string, font: FontSpec, width: number) =>
    countLines(text, width - M.slack, font);

  let text = Math.min(maxText, Math.max(minText, labelWidth, Math.min(chipWidth, maxText)));
  if (labelWidth > maxText) {
    // Two lines: pick the narrowest width that still keeps the label on two lines.
    text = maxText;
    for (let w = Math.max(minText, Math.ceil(labelWidth / 2)); w < maxText; w += 6) {
      if (fits(node.label, M.label, w) <= 2) {
        text = w;
        break;
      }
    }
  }
  if (node.detail) {
    const detailWidth = measureText(node.detail, M.detail) + M.slack;
    const grow = prefer === 'wide' ? 48 : 24;
    if (detailWidth <= maxText && detailWidth - text <= grow) {
      // Slightly wider box, one calm line instead of two ragged ones.
      text = Math.max(text, detailWidth);
    }
    while (text < maxText && fits(node.detail, M.detail, text) > 2) {
      text = Math.min(maxText, text + 8);
    }
  }
  const labelLines = Math.max(1, Math.min(2, fits(node.label, M.label, text)));
  const detailLines = node.detail ? Math.max(1, Math.min(2, fits(node.detail, M.detail, text))) : 0;
  const content =
    labelLines * M.labelLine +
    (detailLines ? M.detailGap + detailLines * M.detailLine : 0) +
    (chip ? M.chipGap + M.chipHeight : 0);
  return {
    width: Math.ceil(text + TEXT_CHROME),
    height: Math.max(
      M.minHeight,
      Math.ceil(M.padY * 2 + M.border * 2 + Math.max(M.iconSize, content)),
    ),
    labelLines,
    detailLines,
    hasChip: Boolean(chip),
  };
}

/** Width of the round step badge (grows for 2+ digits). */
export function stepBadgeWidth(step: number | undefined): number {
  if (step === undefined) return 0;
  const L = EDGE_LABEL_METRICS;
  return Math.max(L.step, Math.ceil(measureText(String(step), L.stepFont) + 7));
}

/** Size of an edge label pill (text and/or step badge), or undefined when there is none. */
export function measureEdgeLabel(
  edge: Pick<GraphEdge, 'label' | 'step'>,
): { width: number; height: number } | undefined {
  const L = EDGE_LABEL_METRICS;
  const hasStep = edge.step !== undefined;
  if (!edge.label && !hasStep) return undefined;
  if (!edge.label)
    return { width: Math.max(L.height, stepBadgeWidth(edge.step) + 4), height: L.height };
  const textWidth = Math.min(L.maxText, measureText(edge.label, L.font) + 4);
  const stepWidth = hasStep ? stepBadgeWidth(edge.step) + L.stepGap : 0;
  return {
    width: Math.ceil(L.padX * 2 + textWidth + stepWidth - (hasStep ? 3 : 0)),
    height: L.height,
  };
}

// ---------------------------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------------------------

const LAYOUT_VERSION = 12;
const layoutCache = new LruCache<string, GraphLayout>(96);
const inflight = new Map<string, Promise<GraphLayout>>();

function resolveDirection(spec: GraphSpec, options: LayoutOptionsInput): GraphDirection {
  return options.direction ?? defaultDirection(spec);
}

/** Stable key of everything that influences the geometry of a layout. */
export function layoutKey(spec: GraphSpec, options: LayoutOptionsInput = {}): string {
  const direction = resolveDirection(spec, options);
  const multiFolder = Boolean(options.multiFolder);
  const shape = JSON.stringify([
    spec.kind === 'sequence' ? 'seq' : 'layered',
    spec.nodes.map((n) => [
      n.id,
      n.label,
      n.detail ?? '',
      n.group ?? '',
      nodeChipText(n, multiFolder) ?? '',
    ]),
    spec.edges.map((e) => [e.id, e.from, e.to, e.label ?? '', e.step ?? '']),
    spec.groups.map((g) => [g.id, g.label]),
  ]);
  return `v${LAYOUT_VERSION}|${measurementMode()}|${direction}|${multiFolder ? 'm' : 's'}|${hashString(shape)}`;
}

/** Synchronously return a cached ELK layout, if one was computed before. */
export function peekGraphLayout(
  spec: GraphSpec,
  options: LayoutOptionsInput = {},
): GraphLayout | undefined {
  return layoutCache.get(layoutKey(spec, options));
}

export function clearLayoutCache(): void {
  layoutCache.clear();
  quickCache.clear();
}

// ---------------------------------------------------------------------------------------------
// ELK
// ---------------------------------------------------------------------------------------------

const NODE_PREFIX = 'n:';
const GROUP_PREFIX = 'g:';
const EDGE_PREFIX = 'e:';
const ROOT_ID = 'root';

export const GROUP_METRICS = {
  /** Space above the members for the group label chip. */
  header: 40,
  pad: 16,
} as const;

/**
 * Layer spacing trick: ELK keeps `nodeNodeBetweenLayers` on BOTH sides of an edge-label layer,
 * so a labelled edge costs 2x that spacing + the label. We use a small layer spacing and give
 * real boxes margins along the flow axis instead: box-to-box gaps stay at
 * 2 * margin + spacing, while label layers only add label + 2 * spacing.
 */
const LAYER_SPACING = 12;
const FLOW_MARGIN = { LR: 16, TB: 14 } as const;

/** Spacing options. Set on the root AND on every group: compound nodes do not inherit them. */
function spacingOptions(direction: GraphDirection): LayoutOptions {
  const tb = direction === 'TB';
  return {
    'elk.spacing.nodeNode': tb ? '32' : '28',
    'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_SPACING),
    'elk.spacing.edgeNode': '16',
    'elk.spacing.edgeEdge': '12',
    'elk.layered.spacing.edgeNodeBetweenLayers': '12',
    'elk.layered.spacing.edgeEdgeBetweenLayers': '12',
    'elk.spacing.edgeLabel': '4',
    'elk.spacing.componentComponent': '48',
    'elk.spacing.nodeSelfLoop': '18',
    'elk.edgeLabels.inline': 'true',
  };
}

/**
 * ELK layered ignores user-set node margins, so boxes are inflated along the flow axis before
 * layout and deflated afterwards (route endpoints on the inflated sides are moved back onto the
 * real border; they are perpendicular to that side, so the route stays orthogonal).
 */
function inflation(direction: GraphDirection): { x: number; y: number } {
  const m = FLOW_MARGIN[direction];
  return direction === 'TB' ? { x: 0, y: m } : { x: m, y: 0 };
}

function rootLayoutOptions(direction: GraphDirection): LayoutOptions {
  const tb = direction === 'TB';
  const inf = inflation(direction);
  const px = Math.max(0, 24 - inf.x);
  const py = Math.max(0, 24 - inf.y);
  return {
    ...spacingOptions(direction),
    'elk.algorithm': 'layered',
    'elk.direction': tb ? 'DOWN' : 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.padding': `[top=${py},left=${px},bottom=${py},right=${px}]`,
    'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    // Cycles are broken before layout (see feedbackEdges), so ELK always gets a DAG.
    'elk.layered.thoroughness': '12',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.unnecessaryBendpoints': 'false',
    'elk.aspectRatio': '1.6',
  };
}

function groupLayoutOptions(direction: GraphDirection): LayoutOptions {
  const { header, pad } = GROUP_METRICS;
  // Members are inflated along the flow axis: take that out of the padding on those sides.
  const inf = inflation(direction);
  const top = Math.max(0, header - inf.y);
  const bottom = Math.max(0, pad - inf.y);
  const side = Math.max(0, pad - inf.x);
  return {
    ...spacingOptions(direction),
    'elk.padding': `[top=${top},left=${side},bottom=${bottom},right=${side}]`,
  };
}

interface Prepared {
  sizes: Map<string, NodeSize>;
  groupOf: Map<string, string>;
  edges: GraphEdge[];
  /** Edges that close a cycle; laid out reversed (see feedbackEdges). */
  reversed: Set<string>;
}

/**
 * Edges that close a cycle, found by a DFS in model order (the order the agent listed boxes and
 * edges, which is usually reading order). They are handed to ELK reversed so they are routed
 * like short forward edges instead of long loops around the diagram; their points are flipped
 * back afterwards.
 */
export function feedbackEdges(nodeIds: string[], edges: GraphEdge[]): Set<string> {
  const out = new Map<string, GraphEdge[]>(nodeIds.map((id) => [id, []]));
  for (const e of edges) if (e.from !== e.to) out.get(e.from)?.push(e);
  const state = new Map<string, 'active' | 'done'>();
  const reversed = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 'active');
    for (const e of out.get(id) ?? []) {
      const s = state.get(e.to);
      if (s === 'active') reversed.add(e.id);
      else if (!s) visit(e.to);
    }
    state.set(id, 'done');
  };
  for (const id of nodeIds) if (!state.has(id)) visit(id);
  return reversed;
}

function prepare(spec: GraphSpec, multiFolder: boolean, direction: GraphDirection): Prepared {
  const sizes = new Map<string, NodeSize>();
  // In LR layouts every extra pixel of box width adds to the (usually too wide) diagram width.
  const [maxWidth, prefer] =
    direction === 'LR'
      ? [NODE_METRICS.maxWidthLR, 'narrow' as const]
      : [NODE_METRICS.maxWidth, 'wide' as const];
  for (const node of spec.nodes) {
    sizes.set(node.id, measureNode(node, multiFolder, maxWidth, prefer));
  }
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const groupOf = new Map<string, string>();
  for (const node of spec.nodes) {
    if (node.group && groupIds.has(node.group)) groupOf.set(node.id, node.group);
  }
  const edges = spec.edges.filter((e) => sizes.has(e.from) && sizes.has(e.to));
  const reversed = feedbackEdges(
    spec.nodes.map((n) => n.id),
    edges,
  );
  return { sizes, groupOf, edges, reversed };
}

function buildElkGraph(spec: GraphSpec, direction: GraphDirection, prepared: Prepared): ElkNode {
  const { sizes, groupOf, edges } = prepared;
  const rootChildren: ElkNode[] = [];
  const groupNodes = new Map<string, ElkNode>();
  const groupLabels = new Map(spec.groups.map((g) => [g.id, g.label]));
  const inf = inflation(direction);
  for (const node of spec.nodes) {
    const size = sizes.get(node.id);
    if (!size) continue;
    const elkNode: ElkNode = {
      id: NODE_PREFIX + node.id,
      width: size.width + inf.x * 2,
      height: size.height + inf.y * 2,
    };
    const gid = groupOf.get(node.id);
    if (!gid) {
      rootChildren.push(elkNode);
      continue;
    }
    let group = groupNodes.get(gid);
    if (!group) {
      // The group's minimum width fits its label chip.
      const labelWidth = measureText(groupLabels.get(gid) ?? '', { size: 11.5, weight: 600 }) + 40;
      group = {
        id: GROUP_PREFIX + gid,
        children: [],
        layoutOptions: {
          ...groupLayoutOptions(direction),
          'elk.nodeSize.constraints': 'MINIMUM_SIZE',
          'elk.nodeSize.minimum': `(${Math.ceil(labelWidth)}, 40)`,
        },
      };
      groupNodes.set(gid, group);
      rootChildren.push(group);
    }
    group.children?.push(elkNode);
  }
  const elkEdges: ElkExtendedEdge[] = edges.map((edge) => {
    // Step-only badges are small enough to sit on the route midpoint; only text labels get a
    // reserved place (a label dummy) in the layout.
    const labelSize = edge.label ? measureEdgeLabel(edge) : undefined;
    const flip = prepared.reversed.has(edge.id);
    const elkEdge: ElkExtendedEdge = {
      id: EDGE_PREFIX + edge.id,
      sources: [NODE_PREFIX + (flip ? edge.to : edge.from)],
      targets: [NODE_PREFIX + (flip ? edge.from : edge.to)],
    };
    if (labelSize) {
      elkEdge.labels = [
        {
          id: `l:${edge.id}`,
          text: edge.label ?? String(edge.step ?? ''),
          width: labelSize.width,
          height: labelSize.height,
          // Must be set on the label itself (it is not inherited from the graph): the pill sits
          // ON the line, centered.
          layoutOptions: { 'elk.edgeLabels.inline': 'true' },
        },
      ];
    }
    return elkEdge;
  });
  return {
    id: ROOT_ID,
    layoutOptions: rootLayoutOptions(direction),
    children: rootChildren,
    edges: elkEdges,
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function extractLayout(
  result: ElkNode,
  spec: GraphSpec,
  key: string,
  direction: GraphDirection,
  prepared: Prepared,
): GraphLayout {
  const nodes: Record<string, NodeBox> = {};
  const groups: GroupBox[] = [];
  const offsets = new Map<string, Point>([[ROOT_ID, { x: 0, y: 0 }]]);
  const groupLabels = new Map(spec.groups.map((g) => [g.id, g.label]));
  const inf = inflation(direction);

  const walk = (parent: ElkNode, ox: number, oy: number) => {
    for (const child of parent.children ?? []) {
      const x = ox + (child.x ?? 0);
      const y = oy + (child.y ?? 0);
      if (child.id.startsWith(GROUP_PREFIX)) {
        const id = child.id.slice(GROUP_PREFIX.length);
        offsets.set(child.id, { x, y });
        groups.push({
          id,
          label: groupLabels.get(id) ?? id,
          x: round(x),
          y: round(y),
          width: round(child.width ?? 0),
          height: round(child.height ?? 0),
        });
        walk(child, x, y);
      } else if (child.id.startsWith(NODE_PREFIX)) {
        const id = child.id.slice(NODE_PREFIX.length);
        const size = prepared.sizes.get(id);
        // Deflate (see inflation()).
        nodes[id] = {
          id,
          x: round(x + inf.x),
          y: round(y + inf.y),
          width: round((child.width ?? 0) - inf.x * 2),
          height: round((child.height ?? 0) - inf.y * 2),
          labelLines: size?.labelLines ?? 1,
          detailLines: size?.detailLines ?? 0,
          hasChip: size?.hasChip ?? false,
        };
      }
    }
  };
  walk(result, 0, 0);

  /** Move a route endpoint lying on an inflated side back onto the real border. */
  const snap = (p: Point, box: NodeBox | undefined): Point => {
    if (!box) return p;
    if (inf.x) {
      if (Math.abs(p.x - (box.x + box.width + inf.x)) < 0.6)
        return { x: box.x + box.width, y: p.y };
      if (Math.abs(p.x - (box.x - inf.x)) < 0.6) return { x: box.x, y: p.y };
    }
    if (inf.y) {
      if (Math.abs(p.y - (box.y + box.height + inf.y)) < 0.6)
        return { x: p.x, y: box.y + box.height };
      if (Math.abs(p.y - (box.y - inf.y)) < 0.6) return { x: p.x, y: box.y };
    }
    return p;
  };

  const edgeById = new Map(prepared.edges.map((e) => [e.id, e]));
  const edges: Record<string, EdgeRoute> = {};
  const collect = (container: ElkNode) => {
    for (const elkEdge of container.edges ?? []) {
      const id = elkEdge.id.slice(EDGE_PREFIX.length);
      const edge = edgeById.get(id);
      if (!edge) continue;
      const containerId = (elkEdge as ElkExtendedEdge & { container?: string }).container;
      const off = offsets.get(containerId ?? container.id) ?? { x: 0, y: 0 };
      const points: Point[] = [];
      for (const section of elkEdge.sections ?? []) {
        const pts = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
        for (const p of pts) {
          const q = { x: round(p.x + off.x), y: round(p.y + off.y) };
          const last = points[points.length - 1];
          if (!last || last.x !== q.x || last.y !== q.y) points.push(q);
        }
      }
      if (prepared.reversed.has(id)) points.reverse();
      if (points.length >= 2) {
        points[0] = snap(points[0] as Point, nodes[edge.from]);
        points[points.length - 1] = snap(points[points.length - 1] as Point, nodes[edge.to]);
      }
      const route: EdgeRoute = { id, source: edge.from, target: edge.to, points };
      const label = elkEdge.labels?.[0];
      if (label && label.x !== undefined && label.y !== undefined) {
        route.label = {
          x: round(label.x + off.x),
          y: round(label.y + off.y),
          width: round(label.width ?? 0),
          height: round(label.height ?? 0),
        };
      }
      edges[id] = route;
    }
    for (const child of container.children ?? []) collect(child);
  };
  collect(result);

  return {
    key,
    engine: 'elk',
    direction,
    width: round(result.width ?? 0),
    height: round(result.height ?? 0),
    nodes,
    groups,
    edges,
  };
}

/** Layered ELK layout of a (non-sequence) diagram. Memoized; never rejects (falls back). */
export function layoutGraph(
  spec: GraphSpec,
  options: LayoutOptionsInput = {},
): Promise<GraphLayout> {
  const key = layoutKey(spec, options);
  const cached = layoutCache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(key);
  if (running) return running;
  const direction = resolveDirection(spec, options);
  const prepared = prepare(spec, Boolean(options.multiFolder), direction);
  const promise = getElk()
    .then((elk) => elk.layout(buildElkGraph(spec, direction, prepared)))
    .then((result) => extractLayout(result, spec, key, direction, prepared))
    .catch((error: unknown) => {
      console.warn('[graph] ELK layout failed, using fallback layout', error);
      return { ...quickLayout(spec, options), key };
    })
    .then((layout) => {
      layoutCache.set(key, layout);
      inflight.delete(key);
      return layout;
    });
  inflight.set(key, promise);
  return promise;
}

// ---------------------------------------------------------------------------------------------
// Quick synchronous fallback (longest-path layering). Used before ELK finishes (thumbnails) and
// when ELK fails.
// ---------------------------------------------------------------------------------------------

const quickCache = new LruCache<string, GraphLayout>(160);

export function quickLayout(spec: GraphSpec, options: LayoutOptionsInput = {}): GraphLayout {
  const key = `quick|${layoutKey(spec, options)}`;
  const cached = quickCache.get(key);
  if (cached) return cached;
  const direction = resolveDirection(spec, options);
  const prepared = prepare(spec, Boolean(options.multiFolder), direction);
  const { sizes, edges } = prepared;
  const ids = spec.nodes.map((n) => n.id).filter((id) => sizes.has(id));
  const index = new Map(ids.map((id, i) => [id, i]));

  // Drop back edges (DFS in model order) so ranks are well defined.
  const out = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) if (e.from !== e.to) out.get(e.from)?.push(e.to);
  const state = new Map<string, 1 | 2>();
  const forward: [string, string][] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    for (const to of out.get(id) ?? []) {
      const s = state.get(to);
      if (s === 1) continue; // back edge
      forward.push([id, to]);
      if (!s) visit(to);
    }
    state.set(id, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);

  const rank = new Map<string, number>(ids.map((id) => [id, 0]));
  for (let pass = 0; pass < ids.length; pass++) {
    let changed = false;
    for (const [a, b] of forward) {
      const next = (rank.get(a) ?? 0) + 1;
      if (next > (rank.get(b) ?? 0)) {
        rank.set(b, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const layers: string[][] = [];
  for (const id of ids) {
    const r = rank.get(id) ?? 0;
    (layers[r] ??= []).push(id);
  }
  for (const layer of layers) layer.sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));

  const tb = direction === 'TB';
  const pad = 24;
  const layerGap = tb ? 52 : 64;
  const nodeGap = tb ? 36 : 28;
  const main = (s: NodeSize) => (tb ? s.height : s.width);
  const cross = (s: NodeSize) => (tb ? s.width : s.height);
  const layerMain = layers.map((layer) =>
    Math.max(0, ...layer.map((id) => main(sizes.get(id) as NodeSize))),
  );
  const layerCross = layers.map(
    (layer) =>
      layer.reduce((sum, id) => sum + cross(sizes.get(id) as NodeSize), 0) +
      nodeGap * Math.max(0, layer.length - 1),
  );
  const maxCross = Math.max(0, ...layerCross);
  const nodes: Record<string, NodeBox> = {};
  let mainPos = pad;
  layers.forEach((layer, li) => {
    let crossPos = pad + (maxCross - (layerCross[li] ?? 0)) / 2;
    for (const id of layer) {
      const s = sizes.get(id) as NodeSize;
      const offsetMain = ((layerMain[li] ?? 0) - main(s)) / 2;
      nodes[id] = {
        id,
        x: tb ? crossPos : mainPos + offsetMain,
        y: tb ? mainPos + offsetMain : crossPos,
        width: s.width,
        height: s.height,
        labelLines: s.labelLines,
        detailLines: s.detailLines,
        hasChip: s.hasChip,
      };
      crossPos += cross(s) + nodeGap;
    }
    mainPos += (layerMain[li] ?? 0) + layerGap;
  });

  const groups: GroupBox[] = [];
  for (const group of spec.groups) {
    const members = Object.values(nodes).filter((n) => prepared.groupOf.get(n.id) === group.id);
    if (!members.length) continue;
    const x = Math.min(...members.map((m) => m.x)) - GROUP_METRICS.pad;
    const y = Math.min(...members.map((m) => m.y)) - GROUP_METRICS.header;
    const x2 = Math.max(...members.map((m) => m.x + m.width)) + GROUP_METRICS.pad;
    const y2 = Math.max(...members.map((m) => m.y + m.height)) + GROUP_METRICS.pad;
    groups.push({ id: group.id, label: group.label, x, y, width: x2 - x, height: y2 - y });
  }

  const routes: Record<string, EdgeRoute> = {};
  for (const e of edges) {
    const a = nodes[e.from];
    const b = nodes[e.to];
    if (!a || !b) continue;
    const start = tb
      ? { x: a.x + a.width / 2, y: a.y + a.height }
      : { x: a.x + a.width, y: a.y + a.height / 2 };
    const end = tb ? { x: b.x + b.width / 2, y: b.y } : { x: b.x, y: b.y + b.height / 2 };
    routes[e.id] = { id: e.id, source: e.from, target: e.to, points: [start, end] };
  }

  const allX = [...Object.values(nodes), ...groups].map((r) => r.x + r.width);
  const allY = [...Object.values(nodes), ...groups].map((r) => r.y + r.height);
  const minX = Math.min(0, ...[...Object.values(nodes), ...groups].map((r) => r.x - pad));
  const minY = Math.min(0, ...[...Object.values(nodes), ...groups].map((r) => r.y - pad));
  if (minX < 0 || minY < 0) {
    // Groups may stick out above/left of the padding: shift everything into positive space.
    const dx = -minX;
    const dy = -minY;
    for (const n of Object.values(nodes)) {
      n.x += dx;
      n.y += dy;
    }
    for (const g of groups) {
      g.x += dx;
      g.y += dy;
    }
    for (const r of Object.values(routes))
      r.points = r.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  }
  const layout: GraphLayout = {
    key,
    engine: 'quick',
    direction,
    width: Math.max(0, ...allX) - Math.min(0, minX) + pad,
    height: Math.max(0, ...allY) - Math.min(0, minY) + pad,
    nodes,
    groups,
    edges: routes,
  };
  quickCache.set(key, layout);
  return layout;
}
