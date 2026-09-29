import { describe, expect, it } from 'vitest';
import type { GraphSpec } from '@codesplainer/shared';
import {
  clearLayoutCache,
  GROUP_METRICS,
  layoutGraph,
  layoutKey,
  measureNode,
  NODE_METRICS,
  peekGraphLayout,
  quickLayout,
  type GraphLayout,
  type Rect,
} from '../../src/graph/layout';
import { architectureSpec, bigSpec, flowSpec, stateSpec } from '../../src/graph/dev/samples';

const chain: GraphSpec = {
  title: 'Chain',
  kind: 'architecture',
  nodes: [
    { id: 'a', label: 'Alpha', kind: 'service', refs: [], expandable: true },
    { id: 'b', label: 'Beta', kind: 'service', refs: [], expandable: true },
    { id: 'c', label: 'Gamma', kind: 'store', refs: [], expandable: true },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', kind: 'call', label: 'calls' },
    { id: 'bc', from: 'b', to: 'c', kind: 'write' },
  ],
  groups: [],
  suggestions: [],
};

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function expectNoOverlaps(layout: GraphLayout) {
  const boxes = Object.values(layout.nodes);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(
        overlaps(boxes[i] as Rect, boxes[j] as Rect),
        `${boxes[i]?.id} overlaps ${boxes[j]?.id}`,
      ).toBe(false);
    }
  }
}

describe('measureNode', () => {
  it('clamps widths and grows with text', () => {
    const short = measureNode({ label: 'UI', refs: [] });
    const long = measureNode({
      label: 'A rather long label that needs two lines',
      detail: 'And a detail sentence that is long enough to wrap onto a second line',
      refs: [],
    });
    expect(short.width).toBe(NODE_METRICS.minWidth);
    expect(long.width).toBeGreaterThan(short.width);
    expect(long.width).toBeLessThanOrEqual(NODE_METRICS.maxWidth);
    expect(long.labelLines).toBeLessThanOrEqual(2);
    expect(long.detailLines).toBe(2);
    expect(long.height).toBeGreaterThan(short.height);
  });

  it('reserves room for the ref chip', () => {
    const plain = measureNode({ label: 'API', refs: [] });
    const withRef = measureNode({
      label: 'API',
      refs: [{ path: 'src/server/index.ts', startLine: 3 }],
    });
    expect(withRef.hasChip).toBe(true);
    expect(withRef.height).toBeGreaterThan(plain.height);
  });
});

describe('layoutGraph', () => {
  it('positions every node with finite coordinates and routes every edge', async () => {
    const layout = await layoutGraph(architectureSpec);
    expect(layout.engine).toBe('elk');
    for (const node of architectureSpec.nodes) {
      const box = layout.nodes[node.id];
      expect(box, node.id).toBeDefined();
      expect(Number.isFinite(box?.x)).toBe(true);
      expect(Number.isFinite(box?.y)).toBe(true);
      expect(box?.width).toBeGreaterThanOrEqual(NODE_METRICS.minWidth);
      expect(box?.width).toBeLessThanOrEqual(NODE_METRICS.maxWidth);
      expect(
        contains({ x: 0, y: 0, width: layout.width, height: layout.height }, box as Rect),
      ).toBe(true);
    }
    for (const edge of architectureSpec.edges) {
      expect(layout.edges[edge.id]?.points.length, edge.id).toBeGreaterThanOrEqual(2);
    }
    expectNoOverlaps(layout);
  });

  it('places groups around their members', async () => {
    const layout = await layoutGraph(architectureSpec);
    expect(layout.groups.map((g) => g.id).sort()).toEqual(['backend', 'frontend']);
    for (const group of layout.groups) {
      const members = architectureSpec.nodes.filter((n) => n.group === group.id);
      expect(members.length).toBeGreaterThan(0);
      for (const m of members) {
        const box = layout.nodes[m.id] as Rect;
        expect(contains(group, box), m.id).toBe(true);
        // Padding on every side, and room for the label chip on top.
        expect(box.x - group.x).toBeGreaterThanOrEqual(GROUP_METRICS.pad - 0.5);
        expect(group.x + group.width - (box.x + box.width)).toBeGreaterThanOrEqual(
          GROUP_METRICS.pad - 0.5,
        );
        expect(box.y - group.y).toBeGreaterThanOrEqual(GROUP_METRICS.header - 0.5);
        expect(group.y + group.height - (box.y + box.height)).toBeGreaterThanOrEqual(
          GROUP_METRICS.pad - 0.5,
        );
      }
      // Non-members stay outside.
      for (const n of architectureSpec.nodes.filter((x) => x.group !== group.id)) {
        expect(overlaps(group, layout.nodes[n.id] as Rect), n.id).toBe(false);
      }
    }
  });

  it('edge routes start at the source box and end at the target box', async () => {
    const layout = await layoutGraph(architectureSpec);
    for (const edge of architectureSpec.edges) {
      const route = layout.edges[edge.id];
      const first = route?.points[0];
      const last = route?.points[route.points.length - 1];
      const near = (p: { x: number; y: number } | undefined, r: Rect | undefined) =>
        Boolean(p && r) &&
        (p as { x: number }).x >= (r as Rect).x - 1 &&
        (p as { x: number }).x <= (r as Rect).x + (r as Rect).width + 1 &&
        (p as { y: number }).y >= (r as Rect).y - 1 &&
        (p as { y: number }).y <= (r as Rect).y + (r as Rect).height + 1;
      expect(near(first, layout.nodes[edge.from]), `${edge.id} start`).toBe(true);
      expect(near(last, layout.nodes[edge.to]), `${edge.id} end`).toBe(true);
    }
  });

  it('gives labelled edges a label box', async () => {
    const layout = await layoutGraph(architectureSpec);
    expect(layout.edges.e2?.label?.width).toBeGreaterThan(20);
    expect(layout.edges.e8?.label).toBeUndefined();
  });

  it('LR grows along x, TB along y', async () => {
    const lr = await layoutGraph(chain, { direction: 'LR' });
    const tb = await layoutGraph(chain, { direction: 'TB' });
    const [a, b, c] = ['a', 'b', 'c'].map((id) => center(lr.nodes[id] as Rect));
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(c!.x);
    expect(Math.abs(a!.y - c!.y)).toBeLessThan(1);
    const [ta, tb2, tc] = ['a', 'b', 'c'].map((id) => center(tb.nodes[id] as Rect));
    expect(ta!.y).toBeLessThan(tb2!.y);
    expect(tb2!.y).toBeLessThan(tc!.y);
    expect(Math.abs(ta!.x - tc!.x)).toBeLessThan(1);
    expect(lr.direction).toBe('LR');
    expect(tb.direction).toBe('TB');
  });

  it('uses the default direction of the diagram kind', async () => {
    const layout = await layoutGraph(flowSpec);
    expect(layout.direction).toBe('TB');
  });

  it('is deterministic and memoized', async () => {
    clearLayoutCache();
    const first = await layoutGraph(bigSpec);
    expect(peekGraphLayout(bigSpec)).toBe(first);
    expect(await layoutGraph(bigSpec)).toBe(first);
    clearLayoutCache();
    expect(peekGraphLayout(bigSpec)).toBeUndefined();
    const second = await layoutGraph(bigSpec);
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });

  it('keys on geometry-relevant input only', () => {
    const recolored: GraphSpec = {
      ...chain,
      edges: chain.edges.map((e) => ({ ...e, kind: 'data' as const })),
    };
    expect(layoutKey(recolored)).toBe(layoutKey(chain));
    expect(layoutKey(chain, { direction: 'TB' })).not.toBe(layoutKey(chain, { direction: 'LR' }));
    const relabeled: GraphSpec = {
      ...chain,
      nodes: chain.nodes.map((n) => ({ ...n, label: `${n.label}!` })),
    };
    expect(layoutKey(relabeled)).not.toBe(layoutKey(chain));
  });

  it('lays out a 20 node diagram without overlaps', async () => {
    const layout = await layoutGraph(bigSpec);
    expect(Object.keys(layout.nodes)).toHaveLength(20);
    expectNoOverlaps(layout);
  });

  it('handles self loops and cycles', async () => {
    const layout = await layoutGraph(stateSpec);
    expect(layout.edges.t6?.points.length).toBeGreaterThanOrEqual(2);
    expectNoOverlaps(layout);
  });
});

describe('quickLayout', () => {
  it('is synchronous, complete and overlap free', () => {
    const layout = quickLayout(architectureSpec);
    expect(layout.engine).toBe('quick');
    expect(Object.keys(layout.nodes)).toHaveLength(architectureSpec.nodes.length);
    expectNoOverlaps(layout);
    for (const box of Object.values(layout.nodes)) {
      expect(contains({ x: 0, y: 0, width: layout.width, height: layout.height }, box)).toBe(true);
    }
  });

  it('ranks along the direction', () => {
    const lr = quickLayout(chain, { direction: 'LR' });
    expect((lr.nodes.a as Rect).x).toBeLessThan((lr.nodes.b as Rect).x);
    const tb = quickLayout(chain, { direction: 'TB' });
    expect((tb.nodes.a as Rect).y).toBeLessThan((tb.nodes.b as Rect).y);
  });
});
