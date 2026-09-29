import type { NodeChildInfo } from '../types';

/** The child diagram a click on a box's badge opens: the latest finished one, else the latest. */
export function preferredChild(items: NodeChildInfo[]): NodeChildInfo | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]?.status === 'done') return items[i];
  return items[items.length - 1];
}
