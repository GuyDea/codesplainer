import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  buildTree,
  childrenOfNode,
  conversationToMarkdown,
  descendantsOf,
  expansionOfNode,
  parseImportPayload,
  pathTo,
  relationLabel,
  rootsOf,
  toConversationExport,
  toMermaid,
  type Conversation,
  type GraphEntry,
  type GraphSpec,
} from '../src';

const spec: GraphSpec = {
  title: 'System',
  kind: 'architecture',
  nodes: [
    {
      id: 'ui',
      label: 'UI',
      kind: 'ui',
      refs: [{ folder: 'app', path: 'src/ui.tsx', startLine: 1, endLine: 9 }],
      expandable: true,
    },
    {
      id: 'api',
      label: 'API "core"',
      kind: 'service',
      refs: [],
      expandable: true,
      highlight: true,
      group: 'be',
    },
    { id: 'db', label: 'DB', kind: 'store', refs: [], expandable: false, group: 'be' },
  ],
  edges: [
    { id: 'e1', from: 'ui', to: 'api', kind: 'call', label: 'fetch', step: 1 },
    { id: 'e2', from: 'api', to: 'db', kind: 'write' },
  ],
  groups: [{ id: 'be', label: 'Backend' }],
};

function entry(
  id: string,
  origin: GraphEntry['origin'],
  extra: Partial<GraphEntry> = {},
): GraphEntry {
  return {
    id,
    origin,
    question: `Q ${id}`,
    status: 'done',
    provider: 'mock',
    detail: 'balanced',
    warnings: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    activity: [],
    attempt: 1,
    spec,
    ...extra,
  };
}

const conv: Conversation = {
  id: 'c1',
  title: 'Onboarding',
  workspaceId: 'w1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  graphs: [
    entry('g1', { type: 'question' }),
    entry('g2', { type: 'expand', parentGraphId: 'g1', nodeId: 'api', nodeLabel: 'API' }),
    entry('g3', { type: 'ask-graph', parentGraphId: 'g1' }),
    entry(
      'g4',
      { type: 'expand', parentGraphId: 'g2', nodeId: 'db', nodeLabel: 'DB' },
      { status: 'running', spec: undefined },
    ),
    entry('g5', { type: 'question' }),
    entry('g6', { type: 'ask-node', parentGraphId: 'g1', nodeId: 'api', nodeLabel: 'API' }),
  ],
};

describe('tree helpers', () => {
  it('finds roots, ancestors, descendants', () => {
    expect(rootsOf(conv).map((g) => g.id)).toEqual(['g1', 'g5']);
    expect(ancestorsOf(conv, 'g4').map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(pathTo(conv, 'g4').map((g) => g.id)).toEqual(['g1', 'g2', 'g4']);
    expect(
      descendantsOf(conv, 'g1')
        .map((g) => g.id)
        .sort(),
    ).toEqual(['g2', 'g3', 'g4', 'g6']);
  });

  it('finds node children and expansions', () => {
    expect(childrenOfNode(conv, 'g1', 'api').map((g) => g.id)).toEqual(['g2', 'g6']);
    expect(expansionOfNode(conv, 'g1', 'api')?.id).toBe('g2');
    expect(expansionOfNode(conv, 'g1', 'ui')).toBeUndefined();
  });

  it('builds a forest with depths', () => {
    const tree = buildTree(conv);
    expect(tree.map((t) => t.entry.id)).toEqual(['g1', 'g5']);
    expect(tree[0]?.children.map((c) => c.entry.id)).toEqual(['g2', 'g3', 'g6']);
    expect(tree[0]?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('labels relations', () => {
    expect(relationLabel(conv.graphs[1]!)).toBe('Expanded “API”');
    expect(relationLabel(conv.graphs[2]!)).toBe('Follow-up');
  });

  it('survives cycles', () => {
    const cyclic: Conversation = {
      ...conv,
      graphs: [
        entry('a', { type: 'ask-graph', parentGraphId: 'b' }),
        entry('b', { type: 'ask-graph', parentGraphId: 'a' }),
      ],
    };
    expect(ancestorsOf(cyclic, 'a').map((g) => g.id)).toEqual(['b']);
    expect(descendantsOf(cyclic, 'a').map((g) => g.id)).toEqual(['b']);
  });
});

describe('mermaid + markdown', () => {
  it('renders flowcharts with groups, escaping and highlights', () => {
    const m = toMermaid(spec);
    expect(m).toContain('flowchart LR');
    expect(m).toContain('subgraph g_be["Backend"]');
    expect(m).toContain('n_api["API #quot;core#quot;"]');
    expect(m).toContain('n_db[("DB")]');
    expect(m).toContain('n_ui -->|"1. fetch"| n_api');
    expect(m).toContain('n_api ==> n_db');
    expect(m).toContain('class n_api highlight;');
  });

  it('renders sequence diagrams ordered by step', () => {
    const m = toMermaid({
      ...spec,
      kind: 'sequence',
      edges: [
        { id: 'b', from: 'api', to: 'db', kind: 'call', label: 'save', step: 2 },
        { id: 'a', from: 'ui', to: 'api', kind: 'call', label: 'post', step: 1 },
      ],
    });
    const lines = m.split('\n');
    expect(lines[0]).toBe('sequenceDiagram');
    expect(lines.indexOf('  n_ui->>n_api: 1. post')).toBeLessThan(
      lines.indexOf('  n_api->>n_db: 2. save'),
    );
  });

  it('exports markdown with a discussion map', () => {
    const md = conversationToMarkdown(conv, {
      workspace: { name: 'Demo', folders: [{ alias: 'app', path: '/tmp/app' }] },
      now: new Date('2026-02-03T00:00:00Z'),
    });
    expect(md).toContain('# Onboarding');
    expect(md).toContain('## Discussion map');
    expect(md).toContain('- [System](#g-g1)');
    expect(md).toContain('  - [Expanded “API” → System](#g-g2)');
    expect(md).toContain('```mermaid');
    expect(md).toContain('`src/ui.tsx:1-9`');
    expect(md).toContain('_Status: running_');
  });
});

describe('export / import', () => {
  it('round-trips a conversation export and strips machine-specific data', () => {
    const withSession: Conversation = {
      ...conv,
      graphs: conv.graphs.map((g) => ({
        ...g,
        session: { provider: 'claude', id: 'sess' },
        activity: [{ ts: 'x', kind: 'tool', text: 'Read' }],
      })),
    };
    const exported = toConversationExport(withSession, {
      name: 'Demo',
      folders: [{ alias: 'app', path: '/tmp/app' }],
    });
    const json = JSON.parse(JSON.stringify(exported));
    const parsed = parseImportPayload(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.payload.kind !== 'conversation') return;
    const graphs = parsed.payload.data.conversation.graphs;
    expect(graphs.every((g) => g.session === undefined && g.activity.length === 0)).toBe(true);
    expect(graphs.find((g) => g.id === 'g4')?.status).toBe('cancelled');
  });

  it('rejects unknown formats', () => {
    expect(parseImportPayload({ format: 'other' }).ok).toBe(false);
    expect(parseImportPayload('x').ok).toBe(false);
  });
});
