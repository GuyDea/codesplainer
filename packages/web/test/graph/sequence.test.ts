import { describe, expect, it } from 'vitest';
import { orderedMessages, type GraphSpec } from '@codesplainer/shared';
import { SEQUENCE_METRICS, sequenceLayout } from '../../src/graph/sequence';
import { sequenceSpec } from '../../src/graph/dev/samples';

describe('sequenceLayout', () => {
  const layout = sequenceLayout(sequenceSpec);

  it('puts participants in one row, left to right in spec order', () => {
    expect(layout.order).toEqual(sequenceSpec.nodes.map((n) => n.id));
    const boxes = layout.order.map((id) => layout.participants[id]);
    const ys = new Set(boxes.map((b) => b?.y));
    expect(ys.size).toBe(1);
    for (let i = 1; i < boxes.length; i++) {
      const prev = boxes[i - 1]!;
      const cur = boxes[i]!;
      expect(cur.x).toBeGreaterThanOrEqual(prev.x + prev.width + SEQUENCE_METRICS.headerGap - 1);
      expect(cur.centerX).toBeGreaterThan(prev.centerX);
    }
  });

  it('orders messages top to bottom by step', () => {
    const expected = orderedMessages(sequenceSpec).map((m) => m.id);
    expect(layout.messages.map((m) => m.id)).toEqual(expected);
    for (let i = 1; i < layout.messages.length; i++) {
      expect(layout.messages[i]!.y).toBeGreaterThan(layout.messages[i - 1]!.y);
    }
  });

  it('draws messages between lifelines and self messages as loops to the right', () => {
    for (const m of layout.messages) {
      const from = layout.participants[m.from]!;
      const to = layout.participants[m.to]!;
      expect(m.points[0]?.x).toBe(from.centerX);
      if (m.self) {
        expect(m.points).toHaveLength(4);
        expect(m.points[1]!.x).toBeGreaterThan(from.centerX);
        expect(m.points[3]!.x).toBe(from.centerX);
        expect(m.points[3]!.y).toBeGreaterThan(m.points[0]!.y);
        expect(m.label!.x).toBeGreaterThan(m.points[1]!.x);
      } else {
        expect(m.points).toHaveLength(2);
        expect(m.points[1]?.x).toBe(to.centerX);
        expect(m.points[0]?.y).toBe(m.points[1]?.y);
      }
    }
    expect(layout.messages.filter((m) => m.self).map((m) => m.id)).toEqual(['s5', 's7']);
  });

  it('keeps labels inside the diagram and lifelines below headers', () => {
    for (const m of layout.messages) {
      const l = m.label!;
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x + l.width).toBeLessThanOrEqual(layout.width);
    }
    const last = layout.messages[layout.messages.length - 1]!;
    for (const line of layout.lifelines) {
      const p = layout.participants[line.id]!;
      expect(line.top).toBe(p.y + p.height);
      expect(line.bottom).toBeGreaterThan(last.y);
      expect(line.bottom).toBeLessThanOrEqual(layout.height);
    }
  });

  it('widens gaps so labels fit between lifelines', () => {
    const spec: GraphSpec = {
      title: 'Wide',
      kind: 'sequence',
      nodes: [
        { id: 'a', label: 'A', kind: 'service', refs: [], expandable: true },
        { id: 'b', label: 'B', kind: 'service', refs: [], expandable: true },
      ],
      edges: [
        { id: 'm', from: 'a', to: 'b', kind: 'call', label: 'a considerably long message label' },
      ],
      groups: [],
      suggestions: [],
    };
    const l = sequenceLayout(spec);
    const m = l.messages[0]!;
    const gap = l.participants.b!.centerX - l.participants.a!.centerX;
    expect(gap).toBeGreaterThanOrEqual(m.label!.width);
    expect(m.label!.x).toBeGreaterThanOrEqual(l.participants.a!.centerX);
  });

  it('orders unnumbered messages after numbered ones, keeping their relative order', () => {
    const spec: GraphSpec = {
      ...sequenceSpec,
      edges: [
        { id: 'x', from: 'user', to: 'ui', kind: 'call' },
        { id: 'y', from: 'ui', to: 'api', kind: 'call', step: 2 },
        { id: 'z', from: 'api', to: 'api', kind: 'call' },
        { id: 'w', from: 'ui', to: 'user', kind: 'data', step: 1 },
      ],
    };
    expect(sequenceLayout(spec).messages.map((m) => m.id)).toEqual(['w', 'y', 'x', 'z']);
  });
});
