/**
 * Geometry of diagram thumbnails: the diagram's layout (the cached ELK layout when available,
 * otherwise the synchronous fallback) scaled into a small box. Pure, synchronous, memoized.
 */
import type { EdgeKind, GraphSpec, NodeKind } from '@codesplainer/shared';
import { LruCache } from './cache';
import { NODE_METRICS, peekGraphLayout, quickLayout, type Point, type Rect } from './layout';
import { measureText } from './measure';
import { sequenceLayout } from './sequence';

export interface ThumbBox extends Rect {
  id: string;
  kind: NodeKind;
  highlight: boolean;
  /** Width of the "text" bar drawn inside the box. */
  barWidth: number;
}

export interface ThumbEdge {
  id: string;
  kind: EdgeKind;
  points: Point[];
}

export interface ThumbnailModel {
  width: number;
  height: number;
  scale: number;
  boxes: ThumbBox[];
  groups: Rect[];
  edges: ThumbEdge[];
  /** Sequence diagrams only. */
  lifelines: { x: number; top: number; bottom: number }[];
}

/** Inner padding of thumbnails in px. */
export const THUMB_PAD = 6;
/** Thumbnails never enlarge boxes beyond this factor (tiny diagrams stay miniature). */
const MAX_SCALE = 0.34;

const cache = new LruCache<string, ThumbnailModel>(256);

export function thumbnailModel(spec: GraphSpec, width: number, height: number): ThumbnailModel {
  const sequence = spec.kind === 'sequence';
  const seq = sequence ? sequenceLayout(spec) : undefined;
  const graph = sequence ? undefined : (peekGraphLayout(spec) ?? quickLayout(spec));
  const sourceKey = seq?.key ?? graph?.key ?? '';
  const key = `${sourceKey}|${graph?.engine ?? 'seq'}|${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const srcWidth = Math.max(1, seq?.width ?? graph?.width ?? 1);
  const srcHeight = Math.max(1, seq?.height ?? graph?.height ?? 1);
  const scale = Math.min(
    MAX_SCALE,
    (width - THUMB_PAD * 2) / srcWidth,
    (height - THUMB_PAD * 2) / srcHeight,
  );
  const ox = (width - srcWidth * scale) / 2;
  const oy = (height - srcHeight * scale) / 2;
  const tx = (x: number) => Math.round((ox + x * scale) * 10) / 10;
  const ty = (y: number) => Math.round((oy + y * scale) * 10) / 10;
  const tr = (r: Rect): Rect => ({
    x: tx(r.x),
    y: ty(r.y),
    width: Math.max(1, Math.round(r.width * scale * 10) / 10),
    height: Math.max(1, Math.round(r.height * scale * 10) / 10),
  });

  const nodeRects: Record<string, Rect> = seq ? seq.participants : (graph?.nodes ?? {});
  const boxes: ThumbBox[] = [];
  for (const node of spec.nodes) {
    const rect = nodeRects[node.id];
    if (!rect) continue;
    const r = tr(rect);
    const textWidth = measureText(node.label, NODE_METRICS.label) * scale;
    boxes.push({
      ...r,
      id: node.id,
      kind: node.kind,
      highlight: Boolean(node.highlight),
      barWidth: Math.max(2, Math.min(r.width * 0.62, textWidth)),
    });
  }
  const kindOf = new Map(spec.edges.map((e) => [e.id, e.kind]));
  const edges: ThumbEdge[] = seq
    ? seq.messages.map((m) => ({
        id: m.id,
        kind: kindOf.get(m.id) ?? 'other',
        points: m.points.map((p) => ({ x: tx(p.x), y: ty(p.y) })),
      }))
    : Object.values(graph?.edges ?? {}).map((e) => ({
        id: e.id,
        kind: kindOf.get(e.id) ?? 'other',
        points: e.points.map((p) => ({ x: tx(p.x), y: ty(p.y) })),
      }));
  const model: ThumbnailModel = {
    width,
    height,
    scale,
    boxes,
    groups: (graph?.groups ?? []).map(tr),
    edges,
    lifelines: (seq?.lifelines ?? []).map((l) => ({
      x: tx(l.x),
      top: ty(l.top),
      bottom: ty(l.bottom),
    })),
  };
  cache.set(key, model);
  return model;
}

/** Node rects of a diagram in thumbnail coordinates (same geometry GraphThumbnail draws). */
export function thumbnailBoxes(
  spec: GraphSpec,
  width: number,
  height: number,
): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const box of thumbnailModel(spec, width, height).boxes) {
    out[box.id] = { x: box.x, y: box.y, width: box.width, height: box.height };
  }
  return out;
}
