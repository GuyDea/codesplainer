import { z } from 'zod';
import {
  EDGE_KINDS,
  GRAPH_KINDS,
  GRAPH_LIMITS,
  NODE_KINDS,
  toEdgeKind,
  toGraphKind,
  toNodeKind,
  type GraphKind,
} from './kinds';
import { slugify, squish, toPosixPath, truncate } from './text';

// ---------------------------------------------------------------------------------------------
// Canonical (normalized) diagram model. This is what is stored, sent to the UI and exported.
// ---------------------------------------------------------------------------------------------

/**
 * A pointer into the code. `folder` is the workspace folder alias; `path` is relative to that
 * folder's root using forward slashes ('' = folder root). The server resolves and validates refs
 * after generation, so refs stored in a GraphSpec always point to existing files/directories.
 */
export const codeRefSchema = z.object({
  folder: z.string().optional(),
  path: z.string(),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  symbol: z.string().optional(),
  isDir: z.boolean().optional(),
});
export type CodeRef = z.infer<typeof codeRefSchema>;

export const graphNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(NODE_KINDS),
  detail: z.string().optional(),
  group: z.string().optional(),
  refs: z.array(codeRefSchema).default([]),
  /** True when there is meaningful inner structure worth a deeper diagram. */
  expandable: z.boolean().default(true),
  /** The 1-3 nodes that are the heart of the answer. */
  highlight: z.boolean().optional(),
});
export type GraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
  kind: z.enum(EDGE_KINDS).default('other'),
  /** Ordinal for flows / sequences (1-based). */
  step: z.number().int().positive().optional(),
  /**
   * Where the relationship happens in the code: the call, import, emit, read or write site.
   * Verified like node refs; omitted when unknown (never an empty array).
   */
  refs: z.array(codeRefSchema).optional(),
});
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphGroupSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type GraphGroup = z.infer<typeof graphGroupSchema>;

export const GRAPH_DIRECTIONS = ['LR', 'TB'] as const;
export type GraphDirection = (typeof GRAPH_DIRECTIONS)[number];

export const graphSpecSchema = z.object({
  title: z.string().min(1),
  /** The direct answer in one or two short sentences. */
  summary: z.string().optional(),
  kind: z.enum(GRAPH_KINDS),
  direction: z.enum(GRAPH_DIRECTIONS).optional(),
  nodes: z.array(graphNodeSchema).min(1),
  edges: z.array(graphEdgeSchema).default([]),
  groups: z.array(graphGroupSchema).default([]),
});
export type GraphSpec = z.infer<typeof graphSpecSchema>;

// ---------------------------------------------------------------------------------------------
// Lenient normalizer: turns whatever an agent produced into a valid GraphSpec (or an error).
// ---------------------------------------------------------------------------------------------

export type NormalizeResult =
  | { ok: true; spec: GraphSpec; warnings: string[] }
  | { ok: false; error: string; warnings: string[] };

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function pick(obj: Json, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const s = squish(v);
    return s || undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(s)) return true;
    if (['false', 'no', 'n', '0'].includes(s)) return false;
  }
  if (typeof v === 'number') return v !== 0;
  return undefined;
}

function posInt(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
}

function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v];
}

const WRAPPER_KEYS = [
  'graph',
  'diagram',
  'result',
  'data',
  'output',
  'response',
  'structured_output',
  'structuredOutput',
  'spec',
  'answer',
];
const NODE_LIST_KEYS = [
  'nodes',
  'boxes',
  'components',
  'items',
  'elements',
  'participants',
  'states',
  'steps',
];
const EDGE_LIST_KEYS = [
  'edges',
  'links',
  'connections',
  'relations',
  'relationships',
  'arrows',
  'messages',
  'transitions',
  'flows',
];

function hasNodeList(obj: Json): boolean {
  return NODE_LIST_KEYS.some((k) => Array.isArray(obj[k]));
}

function unwrap(raw: unknown, depth = 0): Json | undefined {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!isObj(value)) return undefined;
  if (hasNodeList(value) || depth > 3) return value;
  for (const key of WRAPPER_KEYS) {
    const inner = value[key];
    if (isObj(inner) || typeof inner === 'string') {
      const found = unwrap(inner, depth + 1);
      if (found && hasNodeList(found)) return found;
    }
  }
  return value;
}

// ---- refs ---------------------------------------------------------------------------------

const LINES_IN_TEXT = /[\s,(]+lines?\s*(\d+)\s*(?:[-–—]|to|\.\.)\s*(\d+)\s*\)?\s*$/i;
const TRAILING_RANGE = /(?::|#L?|@)(\d+)(?:\s*(?:[-–—]|:|\.\.)\s*L?(\d+))?$/;

function parseLines(v: unknown): { start?: number; end?: number } {
  if (Array.isArray(v)) return { start: posInt(v[0]), end: posInt(v[1] ?? v[0]) };
  if (isObj(v)) {
    return {
      start: posInt(pick(v, ['start', 'from', 'startLine', 'begin'])),
      end: posInt(pick(v, ['end', 'to', 'endLine', 'finish'])),
    };
  }
  if (typeof v === 'number') return { start: posInt(v), end: posInt(v) };
  if (typeof v === 'string') {
    const m = v.match(/(\d+)\s*(?:[-–—:]|to|\.\.)?\s*(\d+)?/);
    if (m) return { start: posInt(m[1]), end: posInt(m[2] ?? m[1]) };
  }
  return {};
}

function cleanPath(p: string): string {
  let path = p.trim().replace(/^file:\/\//, '');
  path = path.replace(/^["'`]|["'`]$/g, '');
  return toPosixPath(path);
}

function refFromString(value: string): Partial<CodeRef> | undefined {
  let text = value.trim();
  if (!text) return undefined;
  let start: number | undefined;
  let end: number | undefined;
  const linesMatch = text.match(LINES_IN_TEXT);
  if (linesMatch) {
    start = posInt(linesMatch[1]);
    end = posInt(linesMatch[2]);
    text = text.slice(0, linesMatch.index).trim();
  } else {
    const rangeMatch = text.match(TRAILING_RANGE);
    if (rangeMatch) {
      start = posInt(rangeMatch[1]);
      end = posInt(rangeMatch[2] ?? rangeMatch[1]);
      text = text.slice(0, rangeMatch.index).trim();
    }
  }
  text = text.replace(/[\s#:@,]+$/, '');
  let folder: string | undefined;
  // "alias:path" prefix (but not Windows drive letters like "C:\").
  const aliasMatch = text.match(/^([A-Za-z0-9._-]{2,}):(?!\/\/)(.+)$/);
  if (aliasMatch && aliasMatch[1] && aliasMatch[2]) {
    folder = aliasMatch[1];
    text = aliasMatch[2];
  }
  const path = cleanPath(text);
  if (!path && !folder) return undefined;
  return { folder, path, startLine: start, endLine: end };
}

function refFromObject(v: Json): Partial<CodeRef> | undefined {
  const rawPath = str(
    pick(v, [
      'path',
      'file',
      'filePath',
      'filepath',
      'file_path',
      'filename',
      'location',
      'uri',
      'dir',
      'directory',
    ]),
  );
  if (!rawPath) return undefined;
  const fromString = refFromString(rawPath) ?? { path: cleanPath(rawPath) };
  const folder =
    str(pick(v, ['folder', 'root', 'workspace', 'alias', 'repo', 'project'])) ?? fromString.folder;
  const lines = parseLines(pick(v, ['lines', 'range', 'lineRange', 'line_range']));
  const start =
    posInt(
      pick(v, ['startLine', 'start_line', 'start', 'line', 'from', 'lineStart', 'line_start']),
    ) ??
    lines.start ??
    fromString.startLine;
  const end =
    posInt(pick(v, ['endLine', 'end_line', 'end', 'to', 'lineEnd', 'line_end'])) ??
    lines.end ??
    fromString.endLine;
  const symbol = str(pick(v, ['symbol', 'name', 'function', 'class', 'identifier', 'method']));
  return { folder, path: fromString.path ?? '', startLine: start, endLine: end, symbol };
}

function normalizeRef(partial: Partial<CodeRef>): CodeRef | undefined {
  const path = partial.path ?? '';
  if (!path && !partial.folder) return undefined;
  let startLine = partial.startLine;
  let endLine = partial.endLine;
  if (startLine === undefined && endLine !== undefined) startLine = endLine;
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    [startLine, endLine] = [endLine, startLine];
  }
  const ref: CodeRef = { path };
  if (partial.folder) ref.folder = partial.folder;
  if (startLine !== undefined) ref.startLine = startLine;
  if (endLine !== undefined) ref.endLine = endLine;
  if (partial.symbol) ref.symbol = truncate(partial.symbol, GRAPH_LIMITS.symbolChars);
  if (partial.isDir !== undefined) ref.isDir = partial.isDir;
  return ref;
}

/** Parse refs in any of the shapes agents tend to produce (strings, objects, arrays thereof). */
export function parseRefs(value: unknown, max: number = GRAPH_LIMITS.maxRefsPerNode): CodeRef[] {
  const out: CodeRef[] = [];
  const seen = new Set<string>();
  for (const item of arr(value)) {
    let partial: Partial<CodeRef> | undefined;
    if (typeof item === 'string') partial = refFromString(item);
    else if (isObj(item)) partial = refFromObject(item);
    const ref = partial ? normalizeRef(partial) : undefined;
    if (!ref) continue;
    const key = `${ref.folder ?? ''}|${ref.path}|${ref.startLine ?? ''}|${ref.endLine ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length >= max) break;
  }
  return out;
}

// ---- nodes / edges / groups -----------------------------------------------------------------

const NODE_ID_KEYS = ['id', 'key', 'slug', 'name', 'label', 'title'];
const NODE_LABEL_KEYS = ['label', 'name', 'title', 'text', 'caption', 'id'];
const NODE_KIND_KEYS = ['kind', 'type', 'category', 'role', 'shape'];
const NODE_DETAIL_KEYS = [
  'detail',
  'details',
  'description',
  'desc',
  'summary',
  'subtitle',
  'note',
  'purpose',
  'responsibility',
];
const NODE_GROUP_KEYS = [
  'group',
  'groupId',
  'group_id',
  'cluster',
  'parent',
  'layer',
  'lane',
  'area',
  'boundary',
];
const NODE_REF_KEYS = [
  'refs',
  'ref',
  'references',
  'files',
  'file',
  'paths',
  'path',
  'location',
  'locations',
  'code',
  'source',
  'sources',
];
const NODE_EXPANDABLE_KEYS = [
  'expandable',
  'canExpand',
  'can_expand',
  'hasChildren',
  'has_children',
  'expand',
];
const NODE_HIGHLIGHT_KEYS = [
  'highlight',
  'highlighted',
  'primary',
  'important',
  'focus',
  'emphasis',
  'emphasize',
];
const NODE_OUTGOING_KEYS = [
  'dependsOn',
  'depends_on',
  'calls',
  'uses',
  'connectsTo',
  'connects_to',
  'targets',
  'next',
];

const EDGE_FROM_KEYS = [
  'from',
  'source',
  'src',
  'start',
  'sourceId',
  'source_id',
  'fromId',
  'from_id',
  'caller',
  'origin',
];
const EDGE_TO_KEYS = [
  'to',
  'target',
  'dst',
  'end',
  'targetId',
  'target_id',
  'toId',
  'to_id',
  'callee',
  'destination',
];
const EDGE_LABEL_KEYS = [
  'label',
  'text',
  'name',
  'description',
  'action',
  'verb',
  'message',
  'title',
];
const EDGE_KIND_KEYS = ['kind', 'type', 'category', 'relation', 'style'];
const EDGE_STEP_KEYS = ['step', 'order', 'seq', 'sequence', 'index', 'number', 'n'];
/**
 * Where an arrow happens in the code. Unlike NODE_REF_KEYS without "source" (an endpoint key
 * here), "path" (often an HTTP route) and "code" (often a code snippet).
 */
const EDGE_REF_KEYS = [
  'refs',
  'ref',
  'references',
  'callSite',
  'call_site',
  'callsite',
  'evidence',
  'location',
  'locations',
  'file',
  'files',
];

const GROUP_LIST_KEYS = [
  'groups',
  'clusters',
  'layers',
  'lanes',
  'areas',
  'subgraphs',
  'boundaries',
];
const GROUP_MEMBER_KEYS = [
  'nodes',
  'members',
  'children',
  'items',
  'contains',
  'nodeIds',
  'node_ids',
];

function humanize(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function parseDirection(v: unknown): 'LR' | 'TB' | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().toUpperCase();
  if (['LR', 'RL', 'RIGHT', 'LEFT', 'HORIZONTAL', 'ROW'].includes(s)) return 'LR';
  if (['TB', 'TD', 'BT', 'DOWN', 'UP', 'VERTICAL', 'COLUMN'].includes(s)) return 'TB';
  return undefined;
}

interface RawNode {
  raw: Json;
  label: string;
  idSource: string;
  groupHint?: string;
}

/**
 * Convert arbitrary agent output (already JSON-parsed, or a JSON string) into a valid GraphSpec.
 * Unknown kinds become "other", dangling edges are dropped, strings are truncated to the limits
 * in GRAPH_LIMITS. Never throws.
 */
export function normalizeGraphSpec(input: unknown): NormalizeResult {
  const warnings: string[] = [];
  const root = unwrap(input);
  if (!root) return { ok: false, error: 'Output is not a JSON object.', warnings };

  // ---- collect raw nodes (flattening one level of nesting into groups) ----
  const rawNodes: RawNode[] = [];
  const nestedGroups: { id: string; label: string }[] = [];
  const nodeList = arr(pick(root, NODE_LIST_KEYS));

  const pushNode = (item: unknown, groupHint?: string) => {
    if (typeof item === 'string') {
      const label = squish(item);
      if (label) rawNodes.push({ raw: {}, label, idSource: label, groupHint });
      return;
    }
    if (!isObj(item)) return;
    const children = GROUP_MEMBER_KEYS.map((k) => item[k]).find(
      (v) => Array.isArray(v) && v.some((c) => isObj(c)),
    ) as unknown[] | undefined;
    const label =
      str(
        pick(
          item,
          NODE_LABEL_KEYS.filter((k) => k !== 'id'),
        ),
      ) ?? (str(item.id) ? humanize(str(item.id) as string) : undefined);
    if (!label) return;
    const idSource = str(pick(item, NODE_ID_KEYS)) ?? label;
    if (children && children.length > 0) {
      // A node with nested nodes is a group.
      const gid = slugify(idSource, 'group');
      nestedGroups.push({ id: gid, label });
      for (const child of children) pushNode(child, gid);
      return;
    }
    rawNodes.push({ raw: item, label, idSource, groupHint });
  };
  for (const item of nodeList) pushNode(item);

  if (rawNodes.length === 0) {
    return { ok: false, error: 'Diagram has no nodes.', warnings };
  }
  if (rawNodes.length > GRAPH_LIMITS.maxNodes) {
    warnings.push(`Diagram had ${rawNodes.length} nodes; kept the first ${GRAPH_LIMITS.maxNodes}.`);
    rawNodes.length = GRAPH_LIMITS.maxNodes;
  }

  // ---- ids and lookup tables ----
  const usedIds = new Set<string>();
  const lookupId = new Map<string, string>(); // raw id / slug / lower label -> final id
  const uniqueId = (base: string) => {
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}-${n++}`;
    usedIds.add(id);
    return id;
  };

  const nodes: GraphNode[] = rawNodes.map((rn) => {
    const id = uniqueId(slugify(rn.idSource, 'node'));
    const rawId = str(rn.raw.id);
    for (const key of [rawId, rn.idSource, rn.label]) {
      if (!key) continue;
      if (!lookupId.has(key)) lookupId.set(key, id);
      const lower = key.toLowerCase();
      if (!lookupId.has(lower)) lookupId.set(lower, id);
      const slug = slugify(key);
      if (!lookupId.has(slug)) lookupId.set(slug, id);
    }
    const kind = toNodeKind(pick(rn.raw, NODE_KIND_KEYS));
    const detailRaw = str(pick(rn.raw, NODE_DETAIL_KEYS));
    const refs = parseRefs(pick(rn.raw, NODE_REF_KEYS));
    const expandableRaw = bool(pick(rn.raw, NODE_EXPANDABLE_KEYS));
    const node: GraphNode = {
      id,
      label: truncate(rn.label, GRAPH_LIMITS.labelChars),
      kind,
      refs,
      expandable: expandableRaw ?? !(kind === 'external' && refs.length === 0),
    };
    if (detailRaw && detailRaw.toLowerCase() !== rn.label.toLowerCase()) {
      node.detail = truncate(detailRaw, GRAPH_LIMITS.detailChars);
    }
    const groupRaw = rn.groupHint ?? str(pick(rn.raw, NODE_GROUP_KEYS));
    if (groupRaw) node.group = groupRaw;
    if (bool(pick(rn.raw, NODE_HIGHLIGHT_KEYS))) node.highlight = true;
    return node;
  });

  const resolveEndpoint = (v: unknown): string | undefined => {
    const key = isObj(v) ? str(pick(v, ['id', 'node', 'name', 'label'])) : str(v);
    if (!key) return undefined;
    return lookupId.get(key) ?? lookupId.get(key.toLowerCase()) ?? lookupId.get(slugify(key));
  };

  // ---- edges ----
  interface Draft {
    from?: string;
    to?: string;
    label?: string;
    kindRaw?: unknown;
    step?: number;
    rawFrom?: unknown;
    rawTo?: unknown;
    refs?: CodeRef[];
  }
  const drafts: Draft[] = [];
  for (const item of arr(pick(root, EDGE_LIST_KEYS))) {
    if (typeof item === 'string') {
      const m = item.match(/^\s*(.+?)\s*(?:-+|=+|~+)>\s*(.+?)(?:\s*[:|]\s*(.+))?\s*$/);
      if (m) drafts.push({ rawFrom: m[1], rawTo: m[2], label: str(m[3]) });
      continue;
    }
    if (!isObj(item)) continue;
    drafts.push({
      rawFrom: pick(item, EDGE_FROM_KEYS),
      rawTo: pick(item, EDGE_TO_KEYS),
      label: str(pick(item, EDGE_LABEL_KEYS)),
      kindRaw: pick(item, EDGE_KIND_KEYS),
      step: posInt(pick(item, EDGE_STEP_KEYS)),
      refs: parseRefs(pick(item, EDGE_REF_KEYS), GRAPH_LIMITS.maxRefsPerEdge),
    });
  }
  // Outgoing lists declared on nodes ("dependsOn": ["b"]).
  rawNodes.forEach((rn, index) => {
    for (const key of NODE_OUTGOING_KEYS) {
      const targets = rn.raw[key];
      if (!Array.isArray(targets)) continue;
      for (const t of targets) {
        drafts.push({
          rawFrom: nodes[index]?.id,
          rawTo: t,
          kindRaw: key.startsWith('depend') ? 'dependency' : key,
        });
      }
    }
  });

  const graphKindHint = toGraphKind(
    pick(root, ['kind', 'type', 'diagramType', 'diagram_type', 'graphType', 'graph_type', 'style']),
  );
  const allowSelfLoops = graphKindHint === 'sequence' || graphKindHint === 'state';
  const edges: GraphEdge[] = [];
  /** Dedupe key -> kept edge (a duplicate may still contribute the refs the first one lacked). */
  const edgeByKey = new Map<string, GraphEdge>();
  const edgeIds = new Set<string>();
  let dropped = 0;
  let selfLoops = 0;
  for (const d of drafts) {
    const from = resolveEndpoint(d.rawFrom);
    const to = resolveEndpoint(d.rawTo);
    if (!from || !to) {
      dropped++;
      continue;
    }
    if (from === to && !allowSelfLoops) {
      selfLoops++;
      continue;
    }
    const label = d.label ? truncate(d.label, GRAPH_LIMITS.edgeLabelChars) : undefined;
    const key = `${from}>${to}|${(label ?? '').toLowerCase()}|${d.step ?? ''}`;
    const existing = edgeByKey.get(key);
    if (existing) {
      if (!existing.refs && d.refs?.length) existing.refs = d.refs;
      continue;
    }
    let id = `e-${from}-${to}`;
    let n = 2;
    while (edgeIds.has(id)) id = `e-${from}-${to}-${n++}`;
    edgeIds.add(id);
    const edge: GraphEdge = { id, from, to, kind: toEdgeKind(d.kindRaw ?? d.label) };
    if (label) edge.label = label;
    if (d.step !== undefined) edge.step = d.step;
    if (d.refs?.length) edge.refs = d.refs;
    edgeByKey.set(key, edge);
    edges.push(edge);
  }
  if (dropped > 0) warnings.push(`Dropped ${dropped} edge(s) pointing to unknown nodes.`);
  if (selfLoops > 0) warnings.push(`Dropped ${selfLoops} self-referencing edge(s).`);
  if (edges.length > GRAPH_LIMITS.maxEdges) {
    warnings.push(`Diagram had ${edges.length} edges; kept the first ${GRAPH_LIMITS.maxEdges}.`);
    edges.length = GRAPH_LIMITS.maxEdges;
  }

  // ---- groups ----
  const groups: GraphGroup[] = [];
  const groupLookup = new Map<string, string>();
  const addGroup = (idSource: string, label: string): string => {
    const existing = groupLookup.get(idSource) ?? groupLookup.get(idSource.toLowerCase());
    if (existing) return existing;
    let id = slugify(idSource, 'group');
    let n = 2;
    while (groups.some((g) => g.id === id) || usedIds.has(id))
      id = `${slugify(idSource, 'group')}-${n++}`;
    groups.push({ id, label: truncate(label, GRAPH_LIMITS.groupLabelChars) });
    for (const k of [
      idSource,
      idSource.toLowerCase(),
      label,
      label.toLowerCase(),
      slugify(idSource),
    ]) {
      if (!groupLookup.has(k)) groupLookup.set(k, id);
    }
    return id;
  };
  for (const g of nestedGroups) addGroup(g.id, g.label);
  for (const item of arr(pick(root, GROUP_LIST_KEYS))) {
    if (typeof item === 'string') {
      addGroup(item, item);
      continue;
    }
    if (!isObj(item)) continue;
    const label = str(pick(item, ['label', 'name', 'title', 'id']));
    if (!label) continue;
    const gid = addGroup(str(pick(item, ['id', 'key', 'name', 'label'])) ?? label, label);
    for (const member of arr(pick(item, GROUP_MEMBER_KEYS))) {
      const nodeId = resolveEndpoint(member);
      const node = nodeId ? nodes.find((nd) => nd.id === nodeId) : undefined;
      if (node && !node.group) node.group = gid;
    }
  }
  for (const node of nodes) {
    if (!node.group) continue;
    const gid = groupLookup.get(node.group) ?? groupLookup.get(node.group.toLowerCase());
    node.group = gid ?? addGroup(node.group, humanize(node.group));
  }
  // Keep only groups that have members; drop a single group that wraps every node (adds nothing).
  let usedGroups = groups.filter((g) => nodes.some((n) => n.group === g.id));
  if (usedGroups.length === 1 && nodes.every((n) => n.group === usedGroups[0]?.id)) usedGroups = [];
  if (usedGroups.length > GRAPH_LIMITS.maxGroups) {
    warnings.push(`Diagram had ${usedGroups.length} groups; kept ${GRAPH_LIMITS.maxGroups}.`);
    usedGroups = usedGroups.slice(0, GRAPH_LIMITS.maxGroups);
  }
  const validGroupIds = new Set(usedGroups.map((g) => g.id));
  for (const node of nodes) {
    if (node.group && !validGroupIds.has(node.group)) delete node.group;
  }

  // ---- highlight cap ----
  let highlighted = 0;
  for (const node of nodes) {
    if (!node.highlight) continue;
    highlighted++;
    if (highlighted > 3) delete node.highlight;
  }

  // ---- graph level ----
  const kind: GraphKind =
    graphKindHint ?? (edges.some((e) => e.step !== undefined) ? 'flow' : 'architecture');
  const spec: GraphSpec = {
    title: truncate(
      str(pick(root, ['title', 'name', 'heading', 'caption'])) ?? 'Diagram',
      GRAPH_LIMITS.titleChars,
    ),
    kind,
    nodes,
    edges,
    groups: usedGroups,
  };
  const summary = str(
    pick(root, ['summary', 'answer', 'tldr', 'tl_dr', 'description', 'explanation', 'overview']),
  );
  if (summary) spec.summary = truncate(summary, GRAPH_LIMITS.summaryChars);
  const direction = parseDirection(pick(root, ['direction', 'layout', 'orientation', 'rankdir']));
  if (direction) spec.direction = direction;

  const checked = graphSpecSchema.safeParse(spec);
  if (!checked.success) {
    return { ok: false, error: `Invalid diagram: ${z.prettifyError(checked.error)}`, warnings };
  }
  return { ok: true, spec: checked.data, warnings };
}

/** Find a node by id. */
export function findNode(spec: GraphSpec | undefined, nodeId: string): GraphNode | undefined {
  return spec?.nodes.find((n) => n.id === nodeId);
}

/** Edges touching a node, split by direction. */
export function neighbours(
  spec: GraphSpec,
  nodeId: string,
): { incoming: GraphEdge[]; outgoing: GraphEdge[] } {
  return {
    incoming: spec.edges.filter((e) => e.to === nodeId),
    outgoing: spec.edges.filter((e) => e.from === nodeId),
  };
}

/** Default layout direction for a diagram. */
export function defaultDirection(spec: Pick<GraphSpec, 'kind' | 'direction'>): GraphDirection {
  if (spec.direction) return spec.direction;
  switch (spec.kind) {
    case 'flow':
    case 'state':
    case 'structure':
      return 'TB';
    default:
      return 'LR';
  }
}
