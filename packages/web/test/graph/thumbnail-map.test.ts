import { describe, expect, it } from 'vitest';
import { parentIdOf } from '@codesplainer/shared';
import { layoutGraph } from '../../src/graph/layout';
import { layoutMap, quickMapLayout, type MapItem } from '../../src/graph/mapLayout';
import { THUMB_PAD, thumbnailBoxes, thumbnailModel } from '../../src/graph/thumbnail';
import {
  architectureSpec,
  bigSpec,
  flowSpec,
  sampleConversation,
  sequenceSpec,
} from '../../src/graph/dev/samples';

const within = (r: { x: number; y: number; width: number; height: number }, w: number, h: number) =>
  r.x >= 0 && r.y >= 0 && r.x + r.width <= w + 0.01 && r.y + r.height <= h + 0.01;

describe('thumbnailBoxes', () => {
  for (const [name, spec] of [
    ['architecture', architectureSpec],
    ['flow', flowSpec],
    ['sequence', sequenceSpec],
    ['big', bigSpec],
  ] as const) {
    it(`keeps every ${name} box inside the thumbnail`, async () => {
      for (const [w, h] of [
        [228, 116],
        [120, 80],
        [300, 60],
      ] as const) {
        const boxes = thumbnailBoxes(spec, w, h);
        expect(Object.keys(boxes).sort()).toEqual(spec.nodes.map((n) => n.id).sort());
        for (const box of Object.values(boxes)) expect(within(box, w, h)).toBe(true);
      }
      if (spec.kind !== 'sequence') {
        // Once the ELK layout is cached, the thumbnail uses it and still fits.
        await layoutGraph(spec);
        for (const box of Object.values(thumbnailBoxes(spec, 228, 116))) {
          expect(within(box, 228, 116)).toBe(true);
        }
      }
    });
  }

  it('respects the padding and memoizes the model', async () => {
    await layoutGraph(architectureSpec);
    const model = thumbnailModel(architectureSpec, 228, 116);
    expect(thumbnailModel(architectureSpec, 228, 116)).toBe(model);
    const minX = Math.min(...model.boxes.map((b) => b.x));
    const minY = Math.min(...model.boxes.map((b) => b.y));
    expect(minX).toBeGreaterThanOrEqual(THUMB_PAD - 0.01);
    expect(minY).toBeGreaterThanOrEqual(THUMB_PAD - 0.01);
    expect(model.edges).toHaveLength(architectureSpec.edges.length);
    expect(model.groups).toHaveLength(2);
  });
});

describe('layoutMap', () => {
  const items: MapItem[] = sampleConversation.graphs.map((g) => ({
    id: g.id,
    parentId: parentIdOf(g.origin),
  }));
  const options = { cardWidth: 240, cardHeight: 200, columnGap: 160, rowGap: 28 };

  const check = (layout: {
    nodes: Record<string, { x: number; y: number; width: number; height: number }>;
  }) => {
    for (const item of items) {
      const node = layout.nodes[item.id];
      expect(node, item.id).toBeDefined();
      if (!item.parentId) continue;
      const parent = layout.nodes[item.parentId]!;
      expect(node!.x, `${item.id} right of ${item.parentId}`).toBeGreaterThanOrEqual(
        parent.x + parent.width,
      );
    }
    const rects = Object.values(layout.nodes);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const overlap =
          a.x < b.x + b.width &&
          b.x < a.x + a.width &&
          a.y < b.y + b.height &&
          b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    }
  };

  it('puts children right of their parents (ELK)', async () => {
    const layout = await layoutMap(items, options);
    check(layout);
    // Roots are stacked top to bottom in creation order.
    expect(layout.nodes.g1!.y).toBeLessThan(layout.nodes.g9!.y);
    expect(layout.nodes.g1!.x).toBe(layout.nodes.g9!.x);
  });

  it('puts children right of their parents (fallback)', () => {
    check(quickMapLayout(items, options));
  });

  it('ignores parents that are not part of the map', async () => {
    const layout = await layoutMap(
      [
        { id: 'a', parentId: 'missing' },
        { id: 'b', parentId: 'a' },
      ],
      options,
    );
    expect(layout.nodes.b!.x).toBeGreaterThan(layout.nodes.a!.x);
  });
});
