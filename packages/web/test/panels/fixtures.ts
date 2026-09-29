import type {
  ActivityItem,
  Conversation,
  GraphEntry,
  GraphSpec,
  ProviderInfo,
} from '@codesplainer/shared';

export const spec: GraphSpec = {
  title: 'System overview',
  summary: 'The UI calls the API server, which stores data in Postgres.',
  kind: 'architecture',
  nodes: [
    {
      id: 'ui',
      label: 'Web UI',
      kind: 'ui',
      refs: [{ folder: 'app', path: 'src/ui/App.tsx', startLine: 3, endLine: 40 }],
      expandable: true,
    },
    {
      id: 'api',
      label: 'API server',
      kind: 'service',
      detail: 'Express app serving JSON.',
      refs: [
        {
          folder: 'app',
          path: 'src/server/api.ts',
          startLine: 10,
          endLine: 80,
          symbol: 'createApp',
        },
      ],
      expandable: true,
      highlight: true,
    },
    { id: 'db', label: 'Postgres', kind: 'store', refs: [], expandable: false },
  ],
  edges: [
    { id: 'e1', from: 'ui', to: 'api', kind: 'call', label: 'fetch /api', step: 1 },
    { id: 'e2', from: 'api', to: 'db', kind: 'write', label: 'insert rows' },
  ],
  groups: [],
  suggestions: ['Where is auth handled?', 'How are errors reported?'],
};

export function entry(
  id: string,
  origin: GraphEntry['origin'],
  extra: Partial<GraphEntry> = {},
): GraphEntry {
  return {
    id,
    origin,
    question: `Question ${id}`,
    status: 'done',
    provider: 'claude',
    detail: 'balanced',
    warnings: [],
    createdAt: '2026-01-01T10:00:00.000Z',
    activity: [],
    attempt: 1,
    spec: { ...spec, title: `Diagram ${id}` },
    ...extra,
  };
}

/**
 * g1 (question)
 *   g2 (expand api)
 *     g4 (expand db, running)
 *   g3 (follow-up)
 * g5 (question) "Deployment pipeline"
 */
export function conversation(): Conversation {
  return {
    id: 'c1',
    title: 'Onboarding',
    workspaceId: 'w1',
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-01-01T10:00:00.000Z',
    graphs: [
      entry('g1', { type: 'question' }),
      entry('g2', { type: 'expand', parentGraphId: 'g1', nodeId: 'api', nodeLabel: 'API server' }),
      entry('g3', { type: 'ask-graph', parentGraphId: 'g1' }),
      entry(
        'g4',
        { type: 'expand', parentGraphId: 'g2', nodeId: 'db', nodeLabel: 'Postgres' },
        { status: 'running', spec: undefined, question: 'Expand: Postgres' },
      ),
      entry('g5', { type: 'question' }, { spec: { ...spec, title: 'Deployment pipeline' } }),
    ],
  };
}

export function provider(
  id: ProviderInfo['id'],
  name: string,
  extra: Partial<ProviderInfo> = {},
): ProviderInfo {
  return {
    id,
    name,
    description: '',
    available: true,
    enabled: true,
    warnings: [],
    models: [],
    capabilities: { fork: true, structuredOutput: true, cost: true, streaming: true },
    experimental: false,
    ...extra,
  };
}

export const providers: ProviderInfo[] = [
  provider('claude', 'Claude Code', {
    models: [
      { id: 'sonnet', label: 'Sonnet' },
      { id: 'opus', label: 'Opus' },
    ],
    defaultModel: 'sonnet',
  }),
  provider('codex', 'Codex'),
  provider('kiro', 'Kiro CLI', { available: false, reason: 'kiro-cli not found' }),
  provider('mock', 'Demo (offline)', { enabled: false }),
];

export function activity(n: number): ActivityItem[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.UTC(2026, 0, 1, 10, 0, i)).toISOString(),
    kind: 'tool' as const,
    text: `Read src/file${i}.ts`,
    path: `src/file${i % 4}.ts`,
  }));
}
