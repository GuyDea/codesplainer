/**
 * Layout of the conversation map: every diagram is a fixed-size card, edges go parent -> child.
 * ELK layered, left to right: roots stacked top to bottom in creation order, trees grow right.
 */
import type { ElkNode } from 'elkjs/lib/elk-api';
import { hashString, LruCache } from './cache';
import { getElk } from './elk';
import type { Rect } from './layout';

export interface MapItem {
  id: string;
  /** Parent diagram id (must be another item to count). */
  parentId?: string;
}

export interface MapLayout {
  key: string;
  width: number;
  height: number;
  nodes: Record<string, Rect>;
}

export interface MapLayoutOptions {
  cardWidth: number;
  cardHeight: number;
  /** Horizontal distance between a parent column and its children (room for edge labels). */
  columnGap?: number;
  /** Vertical distance between cards. */
  rowGap?: number;
}

const cache = new LruCache<string, MapLayout>(32);

function normalized(items: MapItem[]): { id: string; parentId?: string }[] {
  const ids = new Set(items.map((i) => i.id));
  return items.map((i) =>
    i.parentId && ids.has(i.parentId) && i.parentId !== i.id
      ? { id: i.id, parentId: i.parentId }
      : { id: i.id },
  );
}

export function mapLayoutKey(items: MapItem[], options: MapLayoutOptions): string {
  const shape = JSON.stringify([
    options.cardWidth,
    options.cardHeight,
    options.columnGap ?? 0,
    options.rowGap ?? 0,
    normalized(items).map((i) => [i.id, i.parentId ?? '']),
  ]);
  return `map|${hashString(shape)}`;
}

export function peekMapLayout(items: MapItem[], options: MapLayoutOptions): MapLayout | undefined {
  return cache.get(mapLayoutKey(items, options));
}

/** Synchronous tidy-tree fallback: depth columns, leaves stacked, parents centered on children. */
export function quickMapLayout(items: MapItem[], options: MapLayoutOptions): MapLayout {
  const { cardWidth: w, cardHeight: h } = options;
  const colGap = options.columnGap ?? 160;
  const rowGap = options.rowGap ?? 28;
  const pad = 24;
  const list = normalized(items);
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const item of list) {
    if (item.parentId) {
      const arr = children.get(item.parentId) ?? [];
      arr.push(item.id);
      children.set(item.parentId, arr);
    } else roots.push(item.id);
  }
  const nodes: Record<string, Rect> = {};
  let cursor = pad;
  const seen = new Set<string>();
  const place = (id: string, depth: number): number => {
    seen.add(id);
    const kids = (children.get(id) ?? []).filter((k) => !seen.has(k));
    let y: number;
    if (!kids.length) {
      y = cursor;
      cursor += h + rowGap;
    } else {
      const ys = kids.map((k) => place(k, depth + 1));
      y = ((ys[0] ?? 0) + (ys[ys.length - 1] ?? 0)) / 2;
    }
    nodes[id] = { x: pad + depth * (w + colGap), y, width: w, height: h };
    return y;
  };
  for (const r of roots) place(r, 0);
  // Cycles (should not happen): place leftovers as roots.
  for (const item of list) if (!seen.has(item.id)) place(item.id, 0);
  const rects = Object.values(nodes);
  return {
    key: mapLayoutKey(items, options),
    width: Math.max(0, ...rects.map((r) => r.x + r.width)) + pad,
    height: Math.max(0, ...rects.map((r) => r.y + r.height)) + pad,
    nodes,
  };
}

export async function layoutMap(items: MapItem[], options: MapLayoutOptions): Promise<MapLayout> {
  const key = mapLayoutKey(items, options);
  const hit = cache.get(key);
  if (hit) return hit;
  const list = normalized(items);
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.padding': '[top=24,left=24,bottom=24,right=24]',
      'elk.spacing.nodeNode': String(options.rowGap ?? 28),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(options.columnGap ?? 160),
      'elk.separateConnectedComponents': 'false',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'SPLINES',
    },
    children: list.map((i) => ({ id: i.id, width: options.cardWidth, height: options.cardHeight })),
    edges: list
      .filter((i) => i.parentId)
      .map((i) => ({ id: `m:${i.id}`, sources: [i.parentId as string], targets: [i.id] })),
  };
  let layout: MapLayout;
  try {
    const elk = await getElk();
    const result = await elk.layout(graph);
    const nodes: Record<string, Rect> = {};
    for (const child of result.children ?? []) {
      nodes[child.id] = {
        x: Math.round(child.x ?? 0),
        y: Math.round(child.y ?? 0),
        width: options.cardWidth,
        height: options.cardHeight,
      };
    }
    layout = {
      key,
      width: Math.round(result.width ?? 0),
      height: Math.round(result.height ?? 0),
      nodes,
    };
  } catch (error) {
    console.warn('[graph] ELK map layout failed, using fallback layout', error);
    layout = quickMapLayout(items, options);
  }
  cache.set(key, layout);
  return layout;
}
