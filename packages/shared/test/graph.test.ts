import { describe, expect, it } from 'vitest';
import {
  GRAPH_LIMITS,
  normalizeGraphSpec,
  parseRefs,
  toEdgeKind,
  toGraphKind,
  toNodeKind,
} from '../src';

describe('kind aliases', () => {
  it('maps synonyms and plurals', () => {
    expect(toNodeKind('Database')).toBe('store');
    expect(toNodeKind('services')).toBe('service');
    expect(toNodeKind('REST API')).toBe('other');
    expect(toNodeKind('api')).toBe('service');
    expect(toNodeKind(undefined)).toBe('other');
    expect(toEdgeKind('calls')).toBe('call');
    expect(toEdgeKind('depends on')).toBe('dependency');
    expect(toGraphKind('sequence-diagram')).toBe('sequence');
    expect(toGraphKind('nonsense')).toBeUndefined();
  });
});

describe('parseRefs', () => {
  it('parses string refs with line ranges and folder aliases', () => {
    expect(parseRefs('src/app.ts:10-20')).toEqual([
      { path: 'src/app.ts', startLine: 10, endLine: 20 },
    ]);
    expect(parseRefs('api:src/app.ts#L5-L9')).toEqual([
      { folder: 'api', path: 'src/app.ts', startLine: 5, endLine: 9 },
    ]);
    expect(parseRefs('./lib/x.py (lines 3-4)')).toEqual([
      { path: 'lib/x.py', startLine: 3, endLine: 4 },
    ]);
    expect(parseRefs('/abs/path/file.go:12')).toEqual([
      { path: '/abs/path/file.go', startLine: 12, endLine: 12 },
    ]);
  });

  it('parses object refs in many shapes and swaps inverted ranges', () => {
    expect(parseRefs([{ file: 'a.ts', lines: [30, 10], symbol: 'run' }])).toEqual([
      { path: 'a.ts', startLine: 10, endLine: 30, symbol: 'run' },
    ]);
    expect(parseRefs({ filePath: 'b.ts', start_line: 4, end_line: 8, folder: 'web' })).toEqual([
      { folder: 'web', path: 'b.ts', startLine: 4, endLine: 8 },
    ]);
    expect(parseRefs([{ path: 'src/', lines: '1-2' }])).toEqual([
      { path: 'src', startLine: 1, endLine: 2 },
    ]);
  });

  it('dedupes and caps refs', () => {
    const many = Array.from({ length: 20 }, (_, i) => `f${i}.ts`);
    expect(parseRefs(many)).toHaveLength(GRAPH_LIMITS.maxRefsPerNode);
    expect(parseRefs(['a.ts', 'a.ts'])).toHaveLength(1);
  });
});

describe('normalizeGraphSpec', () => {
  it('accepts the canonical shape', () => {
    const r = normalizeGraphSpec({
      title: 'How requests flow',
      summary: 'UI calls API, API queries DB.',
      kind: 'architecture',
      nodes: [
        { id: 'ui', label: 'Web UI', kind: 'ui', refs: [{ path: 'web/src/main.tsx' }] },
        { id: 'api', label: 'API', kind: 'service', highlight: true },
        { id: 'db', label: 'Postgres', kind: 'store', expandable: false },
      ],
      edges: [
        { from: 'ui', to: 'api', label: 'fetch', kind: 'call' },
        { from: 'api', to: 'db', label: 'SQL', kind: 'read' },
      ],
      suggestions: ['How is auth done?'],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.nodes.map((n) => n.id)).toEqual(['ui', 'api', 'db']);
    expect(r.spec.nodes[2]?.expandable).toBe(false);
    expect(r.spec.edges[0]).toMatchObject({ from: 'ui', to: 'api', kind: 'call', label: 'fetch' });
    expect(r.spec.suggestions).toEqual(['How is auth done?']);
    expect(r.warnings).toEqual([]);
  });

  it('unwraps wrappers, maps aliases and resolves edges by label', () => {
    const r = normalizeGraphSpec({
      diagram: {
        name: 'Flow',
        type: 'process',
        boxes: [{ name: 'Parse input', type: 'action' }, { name: 'Validate' }, 'Save'],
        links: [
          { source: 'Parse input', target: 'validate', order: 1 },
          { source: 'Validate', target: 'Save', order: '2', type: 'writes' },
          'Save -> Parse input: loop',
        ],
      },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.kind).toBe('flow');
    expect(r.spec.nodes.map((n) => n.id)).toEqual(['parse-input', 'validate', 'save']);
    expect(r.spec.nodes[0]?.kind).toBe('step');
    expect(r.spec.edges).toHaveLength(3);
    expect(r.spec.edges[1]).toMatchObject({ from: 'validate', to: 'save', step: 2, kind: 'write' });
  });

  it('drops dangling edges and self loops (outside sequence/state) with warnings', () => {
    const r = normalizeGraphSpec({
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      edges: [
        { from: 'a', to: 'zzz' },
        { from: 'a', to: 'a' },
        { from: 'a', to: 'b' },
        { from: 'a', to: 'b' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.edges).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/unknown nodes/);
    expect(r.warnings.join(' ')).toMatch(/self-referencing/);
  });

  it('keeps self loops for sequence diagrams', () => {
    const r = normalizeGraphSpec({
      kind: 'sequence',
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'a', label: 'retry', step: 1 }],
    });
    expect(r.ok && r.spec.edges.length).toBe(1);
  });

  it('dedupes node ids and truncates long text', () => {
    const r = normalizeGraphSpec({
      title: 'x'.repeat(200),
      nodes: [
        { id: 'a', label: 'First' },
        { id: 'a', label: 'Second with a label that is far too long to be a good diagram label' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.nodes.map((n) => n.id)).toEqual(['a', 'a-2']);
    expect(r.spec.nodes[1]!.label.length).toBeLessThanOrEqual(GRAPH_LIMITS.labelChars);
    expect(r.spec.title.length).toBeLessThanOrEqual(GRAPH_LIMITS.titleChars);
  });

  it('builds groups from node.group, group lists and nested children', () => {
    const r = normalizeGraphSpec({
      nodes: [
        { id: 'ui', label: 'UI', group: 'Frontend' },
        { id: 'api', label: 'API' },
        {
          label: 'Backend',
          children: [
            { id: 'svc', label: 'Service' },
            { id: 'db', label: 'DB' },
          ],
        },
      ],
      groups: [{ id: 'edge', label: 'Edge', nodes: ['api'] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const groupOf = Object.fromEntries(r.spec.nodes.map((n) => [n.id, n.group]));
    expect(groupOf.svc).toBe('backend');
    expect(groupOf.db).toBe('backend');
    expect(groupOf.api).toBe('edge');
    expect(groupOf.ui).toBe('frontend');
    expect(r.spec.groups.map((g) => g.label).sort()).toEqual(['Backend', 'Edge', 'Frontend']);
  });

  it('drops a single group wrapping every node', () => {
    const r = normalizeGraphSpec({
      nodes: [
        { id: 'a', label: 'A', group: 'All' },
        { id: 'b', label: 'B', group: 'All' },
      ],
    });
    expect(r.ok && r.spec.groups).toEqual([]);
    expect(r.ok && r.spec.nodes.every((n) => n.group === undefined)).toBe(true);
  });

  it('parses JSON strings and caps node count', () => {
    const nodes = Array.from({ length: 40 }, (_, i) => ({ id: `n${i}`, label: `Node ${i}` }));
    const r = normalizeGraphSpec(JSON.stringify({ nodes }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.nodes).toHaveLength(GRAPH_LIMITS.maxNodes);
    expect(r.warnings[0]).toMatch(/kept the first/);
  });

  it('fails on missing nodes or non-objects', () => {
    expect(normalizeGraphSpec({ title: 'x' }).ok).toBe(false);
    expect(normalizeGraphSpec('not json').ok).toBe(false);
    expect(normalizeGraphSpec(null).ok).toBe(false);
  });

  it('derives edges from node outgoing lists', () => {
    const r = normalizeGraphSpec({
      nodes: [
        { id: 'a', label: 'A', dependsOn: ['b'] },
        { id: 'b', label: 'B' },
      ],
    });
    expect(r.ok && r.spec.edges).toEqual([{ id: 'e-a-b', from: 'a', to: 'b', kind: 'dependency' }]);
  });
});
