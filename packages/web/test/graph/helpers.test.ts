import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '@codesplainer/shared';
import { preferredChild } from '../../src/graph/canvas/children';
import {
  isInteractiveTarget,
  isTypingTarget,
  nearestInDirection,
  startBox,
} from '../../src/graph/canvas/keyboard';
import {
  arrowHead,
  polylineMidpoint,
  roundedPath,
  simplify,
  trimEnd,
} from '../../src/graph/edges/path';
import { feedbackEdges, layoutGraph, measureEdgeLabel } from '../../src/graph/layout';
import { layoutMap } from '../../src/graph/mapLayout';
import {
  MAP_CARD,
  MAP_LAYOUT_OPTIONS,
  MAP_THUMB_LEFT,
  MAP_THUMB_TOP,
} from '../../src/graph/map/metrics';
import { buildMapModel, matchesQuery } from '../../src/graph/map/model';
import { refChipText, refTitle } from '../../src/graph/refs';
import { architectureSpec, sampleConversation } from '../../src/graph/dev/samples';

const edge = (id: string, from: string, to: string): GraphEdge => ({ id, from, to, kind: 'call' });

describe('feedbackEdges', () => {
  it('finds the edges closing cycles in model order', () => {
    const edges = [
      edge('ab', 'a', 'b'),
      edge('bc', 'b', 'c'),
      edge('ca', 'c', 'a'),
      edge('ad', 'a', 'd'),
    ];
    expect([...feedbackEdges(['a', 'b', 'c', 'd'], edges)]).toEqual(['ca']);
  });

  it('keeps DAGs untouched even when edges point to earlier boxes', () => {
    const edges = [edge('ba', 'b', 'a'), edge('cb', 'c', 'b')];
    expect(feedbackEdges(['a', 'b', 'c'], edges).size).toBe(0);
  });

  it('ignores self loops', () => {
    expect(feedbackEdges(['a'], [edge('aa', 'a', 'a')]).size).toBe(0);
  });

  it('routes a feedback edge like a short forward edge', async () => {
    const layout = await layoutGraph(architectureSpec);
    const length = (id: string) => {
      const pts = layout.edges[id]?.points ?? [];
      let sum = 0;
      for (let i = 1; i < pts.length; i++) {
        sum += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
      }
      return sum;
    };
    // e7 (API -> Web UI, "SSE updates") answers e2 (Web UI -> API): similar length, no detour.
    expect(length('e7')).toBeLessThan(length('e2') * 1.6);
    // It still starts at its real source and ends at its real target.
    const route = layout.edges.e7!.points;
    const api = layout.nodes.api!;
    const web = layout.nodes.web!;
    expect(route[0]!.x).toBeCloseTo(api.x, 0);
    expect(route[route.length - 1]!.x).toBeCloseTo(web.x + web.width, 0);
  });
});

describe('edge label size', () => {
  it('fits text and step badge', () => {
    const text = measureEdgeLabel({ label: 'calls' })!;
    const withStep = measureEdgeLabel({ label: 'calls', step: 3 })!;
    const twoDigits = measureEdgeLabel({ label: 'calls', step: 12 })!;
    expect(withStep.width).toBeGreaterThan(text.width);
    expect(twoDigits.width).toBeGreaterThan(withStep.width);
    expect(measureEdgeLabel({ step: 1 })).toEqual({ width: 20, height: 20 });
    expect(measureEdgeLabel({})).toBeUndefined();
  });
});

describe('path helpers', () => {
  it('rounds corners and keeps straight lines straight', () => {
    expect(
      roundedPath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]),
    ).toBe('M 0 0 L 100 0');
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 50 },
    ]);
    expect(d).toContain('Q 50 0');
    expect(d.startsWith('M 0 0')).toBe(true);
    expect(d.endsWith('L 50 50')).toBe(true);
  });

  it('drops duplicate and collinear points', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
    ]);
  });

  it('finds the midpoint by length and trims the end', () => {
    expect(
      polylineMidpoint([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 30 },
      ]),
    ).toEqual({ x: 10, y: 10 });
    expect(
      trimEnd(
        [
          { x: 0, y: 0 },
          { x: 0, y: 40 },
        ],
        6,
      ),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 34 },
    ]);
    expect(
      arrowHead([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
      ]).startsWith('M 40 0'),
    ).toBe(true);
  });
});

describe('keyboard navigation', () => {
  const boxes = [
    { id: 'a', x: 0, y: 0, width: 100, height: 40 },
    { id: 'b', x: 200, y: 0, width: 100, height: 40 },
    { id: 'c', x: 200, y: 200, width: 100, height: 40 },
    { id: 'd', x: 0, y: 200, width: 100, height: 40, highlight: true },
  ];

  it('moves to the nearest box in the arrow direction', () => {
    expect(nearestInDirection(boxes, 'a', 'right')).toBe('b');
    expect(nearestInDirection(boxes, 'a', 'down')).toBe('d');
    expect(nearestInDirection(boxes, 'b', 'down')).toBe('c');
    expect(nearestInDirection(boxes, 'c', 'left')).toBe('d');
    expect(nearestInDirection(boxes, 'a', 'left')).toBeUndefined();
    expect(nearestInDirection(boxes, 'a', 'up')).toBeUndefined();
  });

  it('leaves keys on text fields and buttons alone', () => {
    const input = document.createElement('input');
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.appendChild(icon);
    const div = document.createElement('div');
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(button)).toBe(false);
    expect(isInteractiveTarget(icon)).toBe(true);
    expect(isInteractiveTarget(div)).toBe(false);
  });

  it('starts on a highlighted box, else top-left', () => {
    expect(startBox(boxes)).toBe('d');
    expect(startBox(boxes.map((b) => ({ ...b, highlight: false })))).toBe('a');
  });
});

describe('children and refs', () => {
  it('prefers the latest finished child diagram', () => {
    expect(
      preferredChild([
        { graphId: '1', type: 'expand', status: 'done', title: 'A' },
        { graphId: '2', type: 'ask-node', status: 'done', title: 'B' },
        { graphId: '3', type: 'expand', status: 'running', title: 'C' },
      ])?.graphId,
    ).toBe('2');
    expect(
      preferredChild([{ graphId: '9', type: 'expand', status: 'error', title: 'X' }])?.graphId,
    ).toBe('9');
    expect(preferredChild([])).toBeUndefined();
  });

  it('formats ref chips', () => {
    expect(refChipText({ path: 'src/server/api.ts', startLine: 42 })).toBe('api.ts:42');
    expect(refChipText({ folder: 'web', path: 'src/app', isDir: true }, true)).toBe('app/');
    expect(refChipText({ folder: 'web', path: '' })).toBe('web/');
    expect(
      refTitle({ folder: 'web', path: 'a/b.ts', startLine: 3, endLine: 9, symbol: 'run' }),
    ).toBe('web:a/b.ts:3-9 (run)');
  });
});

describe('conversation map model', () => {
  it('connects children to the expanded box inside the parent thumbnail', async () => {
    for (const g of sampleConversation.graphs) if (g.spec) await layoutGraph(g.spec);
    const layout = await layoutMap(
      sampleConversation.graphs.map((g) => ({
        id: g.id,
        parentId: 'parentGraphId' in g.origin ? g.origin.parentGraphId : undefined,
      })),
      MAP_LAYOUT_OPTIONS,
    );
    const { nodes, edges } = buildMapModel(sampleConversation, layout, 'g2', undefined);
    expect(nodes).toHaveLength(sampleConversation.graphs.length);
    const root = nodes.find((n) => n.id === 'g1')!;
    // g2/g3 expand "runner"/"store", g4 asks about "api": three ports on the root card.
    expect(root.data.ports.map((p) => p.id).sort()).toEqual(['n:api', 'n:runner', 'n:store']);
    for (const port of root.data.ports) {
      expect(port.x).toBeGreaterThanOrEqual(MAP_THUMB_LEFT);
      expect(port.x).toBeLessThanOrEqual(MAP_THUMB_LEFT + MAP_CARD.thumbWidth);
      expect(port.y).toBeGreaterThanOrEqual(MAP_THUMB_TOP);
      expect(port.y).toBeLessThanOrEqual(MAP_THUMB_TOP + MAP_CARD.thumbHeight);
    }
    const toG2 = edges.find((e) => e.target === 'g2')!;
    expect(toG2.sourceHandle).toBe('n:runner');
    expect(toG2.data?.relation).toBe('expand');
    expect(toG2.data?.subject).toBe('Agent runner');
    expect(edges.find((e) => e.target === 'g4')?.data?.relation).toBe('ask');
    expect(edges.find((e) => e.target === 'g6')?.sourceHandle).toBe('out');
    expect(edges.find((e) => e.target === 'g6')?.data?.relation).toBe('follow-up');
    expect(edges.find((e) => e.target === 'g8')?.data?.relation).toBe('code');
    expect(nodes.find((n) => n.id === 'g2')?.data.isCurrent).toBe(true);
    // Roots have no incoming edge.
    expect(edges.some((e) => e.target === 'g1' || e.target === 'g9')).toBe(false);
  });

  it('matches titles, questions and node labels', () => {
    const g1 = sampleConversation.graphs[0]!;
    expect(matchesQuery(g1, '')).toBe(true);
    expect(matchesQuery(g1, 'ANSWER')).toBe(true);
    expect(matchesQuery(g1, 'coding agent')).toBe(true);
    expect(matchesQuery(g1, 'kubernetes')).toBe(false);
  });

  it('dims cards that do not match the highlight query', async () => {
    const layout = await layoutMap(
      sampleConversation.graphs.map((g) => ({ id: g.id })),
      MAP_LAYOUT_OPTIONS,
    );
    const { nodes } = buildMapModel(sampleConversation, layout, null, 'lock');
    const lit = nodes.filter((n) => !n.data.dim).map((n) => n.id);
    expect(lit).toContain('g7');
    expect(lit).not.toContain('g9');
  });
});
