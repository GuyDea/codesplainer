/**
 * Sequence diagram layout: participants in a row with lifelines, messages as horizontal arrows
 * from top to bottom (orderedMessages), self messages as small loops. Pure and synchronous.
 */
import { orderedMessages, type GraphSpec } from '@codesplainer/shared';
import { LruCache } from './cache';
import {
  layoutKey,
  measureEdgeLabel,
  measureNode,
  type LayoutOptionsInput,
  type NodeBox,
  type Point,
  type Rect,
} from './layout';

export interface SequenceParticipant extends NodeBox {
  /** X of the lifeline. */
  centerX: number;
}

export interface SequenceMessage {
  id: string;
  from: string;
  to: string;
  /** Position in the ordered message list (0-based). */
  index: number;
  /** Y of the arrow line. */
  y: number;
  self: boolean;
  /** Absolute polyline (2 points, or 4 for self loops). */
  points: Point[];
  label?: Rect;
}

export interface Lifeline {
  id: string;
  x: number;
  top: number;
  bottom: number;
}

export interface SequenceLayout {
  key: string;
  width: number;
  height: number;
  /** Participant ids, left to right. */
  order: string[];
  participants: Record<string, SequenceParticipant>;
  lifelines: Lifeline[];
  messages: SequenceMessage[];
}

export const SEQUENCE_METRICS = {
  pad: 24,
  maxParticipantWidth: 220,
  /** Minimum free space between two participant headers. */
  headerGap: 40,
  /** Distance from header bottom to the first message. */
  firstRow: 46,
  row: 46,
  selfRow: 58,
  tail: 30,
  loopWidth: 34,
  loopHeight: 22,
  /** Gap between an arrow and its label. */
  labelGap: 5,
  /** Horizontal margin around labels. */
  labelMargin: 20,
} as const;

const cache = new LruCache<string, SequenceLayout>(64);

export function sequenceLayout(spec: GraphSpec, options: LayoutOptionsInput = {}): SequenceLayout {
  const key = `seq|${layoutKey(spec, options)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = SEQUENCE_METRICS;
  const multiFolder = Boolean(options.multiFolder);

  const order = spec.nodes.map((n) => n.id);
  const sizes = spec.nodes.map((n) => measureNode(n, multiFolder, S.maxParticipantWidth));
  const headerHeight = Math.max(0, ...sizes.map((s) => s.height));
  const col = new Map(order.map((id, i) => [id, i]));
  const messages = orderedMessages(spec).filter((m) => col.has(m.from) && col.has(m.to));
  const labels = messages.map((m) => measureEdgeLabel(m));

  // gaps[i] = distance between the centers of participant i and i+1.
  const n = order.length;
  const gaps: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    gaps.push((sizes[i]?.width ?? 0) / 2 + (sizes[i + 1]?.width ?? 0) / 2 + S.headerGap);
  }
  // Extra room right of the last lifeline (self loops on the last participant).
  let tailRight = (sizes[n - 1]?.width ?? 0) / 2;

  const spans = messages
    .map((m, i) => ({ a: col.get(m.from) ?? 0, b: col.get(m.to) ?? 0, label: labels[i] }))
    .map((s) => ({ lo: Math.min(s.a, s.b), hi: Math.max(s.a, s.b), label: s.label }))
    .sort((x, y) => x.hi - x.lo - (y.hi - y.lo));
  for (const s of spans) {
    if (s.lo === s.hi) {
      const need = S.loopWidth + 10 + (s.label?.width ?? 0) + S.labelMargin;
      if (s.lo === n - 1) tailRight = Math.max(tailRight, need);
      else if ((gaps[s.lo] ?? 0) < need) gaps[s.lo] = need;
      continue;
    }
    if (!s.label) continue;
    const need = s.label.width + S.labelMargin * 2;
    let have = 0;
    for (let i = s.lo; i < s.hi; i++) have += gaps[i] ?? 0;
    if (have >= need) continue;
    const extra = (need - have) / (s.hi - s.lo);
    for (let i = s.lo; i < s.hi; i++) gaps[i] = (gaps[i] ?? 0) + extra;
  }

  const participants: Record<string, SequenceParticipant> = {};
  let cx = S.pad + (sizes[0]?.width ?? 0) / 2;
  order.forEach((id, i) => {
    const size = sizes[i];
    if (!size) return;
    if (i > 0) cx += gaps[i - 1] ?? 0;
    participants[id] = {
      id,
      x: Math.round(cx - size.width / 2),
      y: S.pad,
      width: size.width,
      height: headerHeight,
      labelLines: size.labelLines,
      detailLines: size.detailLines,
      hasChip: size.hasChip,
      centerX: Math.round(cx),
    };
  });

  const headerBottom = S.pad + headerHeight;
  let y = headerBottom + S.firstRow;
  const laidOut: SequenceMessage[] = messages.map((m, index) => {
    const from = participants[m.from] as SequenceParticipant;
    const to = participants[m.to] as SequenceParticipant;
    const size = labels[index];
    const self = m.from === m.to;
    let points: Point[];
    let label: Rect | undefined;
    if (self) {
      const x = from.centerX;
      points = [
        { x, y },
        { x: x + S.loopWidth, y },
        { x: x + S.loopWidth, y: y + S.loopHeight },
        { x, y: y + S.loopHeight },
      ];
      if (size) {
        label = {
          x: x + S.loopWidth + 10,
          y: y + S.loopHeight / 2 - size.height / 2,
          width: size.width,
          height: size.height,
        };
      }
    } else {
      points = [
        { x: from.centerX, y },
        { x: to.centerX, y },
      ];
      if (size) {
        label = {
          x: (from.centerX + to.centerX) / 2 - size.width / 2,
          y: y - S.labelGap - size.height,
          width: size.width,
          height: size.height,
        };
      }
    }
    const msg: SequenceMessage = { id: m.id, from: m.from, to: m.to, index, y, self, points };
    if (label) msg.label = label;
    y += self ? S.selfRow : S.row;
    return msg;
  });

  const last = laidOut[laidOut.length - 1];
  const lastBottom = last ? last.y + (last.self ? S.loopHeight : 0) : headerBottom;
  const bottom = lastBottom + S.tail;
  const lifelines: Lifeline[] = order
    .map((id) => participants[id])
    .filter((p): p is SequenceParticipant => Boolean(p))
    .map((p) => ({ id: p.id, x: p.centerX, top: headerBottom, bottom }));

  const lastCenter = participants[order[n - 1] ?? '']?.centerX ?? S.pad;
  const layout: SequenceLayout = {
    key,
    width: Math.round(lastCenter + tailRight + S.pad),
    height: Math.round(bottom + S.pad),
    order,
    participants,
    lifelines,
    messages: laidOut,
  };
  cache.set(key, layout);
  return layout;
}
