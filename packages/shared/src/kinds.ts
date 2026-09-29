/**
 * Vocabulary used by diagrams. Agents are asked to use exactly these values; the lenient
 * normalizer (see graph.ts) maps common synonyms onto them.
 */

export const NODE_KINDS = [
  'actor',
  'ui',
  'service',
  'module',
  'component',
  'class',
  'function',
  'data',
  'store',
  'external',
  'queue',
  'config',
  'file',
  'step',
  'decision',
  'event',
  'test',
  'other',
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const NODE_KIND_INFO: Record<NodeKind, { label: string; hint: string }> = {
  actor: { label: 'Actor', hint: 'user, caller or external trigger' },
  ui: { label: 'UI', hint: 'screen, page, widget, CLI surface' },
  service: { label: 'Service', hint: 'server, process, app, worker' },
  module: { label: 'Module', hint: 'package, folder, library, namespace' },
  component: { label: 'Component', hint: 'logical part made of several files' },
  class: { label: 'Class', hint: 'class, struct, interface, object' },
  function: { label: 'Function', hint: 'function, method, handler, hook' },
  data: { label: 'Data', hint: 'model, type, schema, DTO, message shape' },
  store: { label: 'Store', hint: 'database, cache, file storage, state store' },
  external: { label: 'External', hint: 'third-party API or system outside the code' },
  queue: { label: 'Queue', hint: 'queue, topic, bus, stream, channel' },
  config: { label: 'Config', hint: 'configuration, env, feature flags' },
  file: { label: 'File', hint: 'a single notable file or script' },
  step: { label: 'Step', hint: 'a step in a flow or algorithm' },
  decision: { label: 'Decision', hint: 'branch or condition in a flow' },
  event: { label: 'Event', hint: 'event, signal, message type' },
  test: { label: 'Test', hint: 'test suite or fixture' },
  other: { label: 'Other', hint: 'anything else' },
};

export const EDGE_KINDS = [
  'call',
  'data',
  'event',
  'dependency',
  'contains',
  'flow',
  'read',
  'write',
  'inherit',
  'other',
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const EDGE_KIND_INFO: Record<EdgeKind, { label: string; hint: string }> = {
  call: { label: 'Calls', hint: 'invokes / requests' },
  data: { label: 'Data', hint: 'passes or returns data' },
  event: { label: 'Event', hint: 'emits / subscribes asynchronously' },
  dependency: { label: 'Depends on', hint: 'imports / uses' },
  contains: { label: 'Contains', hint: 'owns / is composed of' },
  flow: { label: 'Then', hint: 'next step in a flow' },
  read: { label: 'Reads', hint: 'reads from a store' },
  write: { label: 'Writes', hint: 'writes to a store' },
  inherit: { label: 'Inherits', hint: 'extends / implements' },
  other: { label: 'Related', hint: 'other relationship' },
};

export const GRAPH_KINDS = [
  'architecture',
  'flow',
  'sequence',
  'dataflow',
  'structure',
  'dependency',
  'state',
] as const;
export type GraphKind = (typeof GRAPH_KINDS)[number];

export const GRAPH_KIND_INFO: Record<GraphKind, { label: string; hint: string }> = {
  architecture: { label: 'Architecture', hint: 'parts of a system and how they talk' },
  flow: { label: 'Flow', hint: 'ordered steps of a process' },
  sequence: { label: 'Sequence', hint: 'interactions between participants over time' },
  dataflow: { label: 'Data flow', hint: 'how data moves and transforms' },
  structure: { label: 'Structure', hint: 'composition / inheritance of types or modules' },
  dependency: { label: 'Dependencies', hint: 'import or package dependencies' },
  state: { label: 'States', hint: 'states and transitions' },
};

export const DETAIL_LEVELS = ['simple', 'balanced', 'detailed'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

/** Node-count targets per detail level. `max` is what we ask for; GRAPH_LIMITS.maxNodes is the hard cap. */
export const DETAIL_LEVEL_INFO: Record<DetailLevel, { label: string; min: number; max: number }> = {
  simple: { label: 'Simple', min: 3, max: 6 },
  balanced: { label: 'Balanced', min: 4, max: 9 },
  detailed: { label: 'Detailed', min: 7, max: 14 },
};

/** Hard limits applied when normalizing agent output. Keep diagrams small and wording short. */
export const GRAPH_LIMITS = {
  maxNodes: 24,
  maxEdges: 48,
  maxGroups: 6,
  maxRefsPerNode: 5,
  maxSuggestions: 4,
  titleChars: 70,
  summaryChars: 260,
  labelChars: 40,
  detailChars: 120,
  edgeLabelChars: 32,
  groupLabelChars: 40,
  suggestionChars: 90,
  symbolChars: 120,
} as const;

// ---------------------------------------------------------------------------------------------
// Synonyms accepted from agents (lower-cased, non-alphanumerics stripped before lookup).
// ---------------------------------------------------------------------------------------------

export const NODE_KIND_ALIASES: Record<string, NodeKind> = {
  user: 'actor',
  person: 'actor',
  human: 'actor',
  client: 'actor',
  caller: 'actor',
  trigger: 'actor',
  frontend: 'ui',
  page: 'ui',
  screen: 'ui',
  view: 'ui',
  widget: 'ui',
  cli: 'ui',
  interface: 'class',
  server: 'service',
  api: 'service',
  backend: 'service',
  process: 'service',
  worker: 'service',
  daemon: 'service',
  app: 'service',
  application: 'service',
  microservice: 'service',
  lambda: 'service',
  package: 'module',
  library: 'module',
  lib: 'module',
  folder: 'module',
  directory: 'module',
  dir: 'module',
  namespace: 'module',
  layer: 'module',
  subsystem: 'component',
  feature: 'component',
  struct: 'class',
  object: 'class',
  trait: 'class',
  method: 'function',
  handler: 'function',
  hook: 'function',
  func: 'function',
  fn: 'function',
  procedure: 'function',
  endpoint: 'function',
  route: 'function',
  middleware: 'function',
  type: 'data',
  model: 'data',
  schema: 'data',
  entity: 'data',
  dto: 'data',
  enum: 'data',
  record: 'data',
  table: 'store',
  database: 'store',
  db: 'store',
  cache: 'store',
  storage: 'store',
  filesystem: 'store',
  state: 'store',
  repository: 'store',
  thirdparty: 'external',
  saas: 'external',
  cloud: 'external',
  system: 'external',
  externalapi: 'external',
  topic: 'queue',
  bus: 'queue',
  stream: 'queue',
  channel: 'queue',
  broker: 'queue',
  settings: 'config',
  setting: 'config',
  env: 'config',
  environment: 'config',
  configuration: 'config',
  flag: 'config',
  script: 'file',
  action: 'step',
  task: 'step',
  stage: 'step',
  phase: 'step',
  start: 'step',
  end: 'step',
  condition: 'decision',
  branch: 'decision',
  choice: 'decision',
  gateway: 'decision',
  signal: 'event',
  message: 'event',
  notification: 'event',
  spec: 'test',
  tests: 'test',
  fixture: 'test',
};

export const EDGE_KIND_ALIASES: Record<string, EdgeKind> = {
  calls: 'call',
  invokes: 'call',
  invoke: 'call',
  request: 'call',
  requests: 'call',
  http: 'call',
  rpc: 'call',
  uses: 'dependency',
  use: 'dependency',
  imports: 'dependency',
  import: 'dependency',
  depends: 'dependency',
  dependson: 'dependency',
  requires: 'dependency',
  emits: 'event',
  emit: 'event',
  publishes: 'event',
  publish: 'event',
  subscribes: 'event',
  subscribe: 'event',
  listens: 'event',
  triggers: 'event',
  async: 'event',
  reads: 'read',
  query: 'read',
  queries: 'read',
  loads: 'read',
  writes: 'write',
  stores: 'write',
  saves: 'write',
  persists: 'write',
  extends: 'inherit',
  implements: 'inherit',
  inherits: 'inherit',
  has: 'contains',
  owns: 'contains',
  includes: 'contains',
  composition: 'contains',
  next: 'flow',
  then: 'flow',
  sequence: 'flow',
  control: 'flow',
  transition: 'flow',
  sends: 'data',
  send: 'data',
  returns: 'data',
  passes: 'data',
  dataflow: 'data',
};

export const GRAPH_KIND_ALIASES: Record<string, GraphKind> = {
  overview: 'architecture',
  component: 'architecture',
  components: 'architecture',
  system: 'architecture',
  context: 'architecture',
  process: 'flow',
  algorithm: 'flow',
  controlflow: 'flow',
  flowchart: 'flow',
  steps: 'flow',
  workflow: 'flow',
  pipeline: 'flow',
  sequencediagram: 'sequence',
  interaction: 'sequence',
  datamodel: 'structure',
  class: 'structure',
  classes: 'structure',
  er: 'structure',
  erd: 'structure',
  hierarchy: 'structure',
  dependencies: 'dependency',
  imports: 'dependency',
  statemachine: 'state',
  states: 'state',
  lifecycle: 'state',
};

function aliasKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function lookup<T extends string>(
  value: unknown,
  known: readonly T[],
  aliases: Record<string, T>,
): T | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.trim().toLowerCase();
  if ((known as readonly string[]).includes(lower)) return lower as T;
  const key = aliasKey(value);
  if ((known as readonly string[]).includes(key)) return key as T;
  if (aliases[key]) return aliases[key];
  // Plural / suffix tolerance ("services", "functions").
  const singular = key.endsWith('s') ? key.slice(0, -1) : key;
  if ((known as readonly string[]).includes(singular)) return singular as T;
  return aliases[singular];
}

export function toNodeKind(value: unknown): NodeKind {
  return lookup(value, NODE_KINDS, NODE_KIND_ALIASES) ?? 'other';
}

export function toEdgeKind(value: unknown): EdgeKind {
  return lookup(value, EDGE_KINDS, EDGE_KIND_ALIASES) ?? 'other';
}

export function toGraphKind(value: unknown): GraphKind | undefined {
  return lookup(value, GRAPH_KINDS, GRAPH_KIND_ALIASES);
}
