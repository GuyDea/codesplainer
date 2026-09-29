import type { Rect } from '../layout';

export type ArrowDirection = 'left' | 'right' | 'up' | 'down';

export const ARROW_KEYS: Record<string, ArrowDirection> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * The box nearest to `fromId` in a direction. Candidates must lie in that half plane; aligned
 * boxes are preferred over diagonal ones.
 */
export function nearestInDirection(
  boxes: (Rect & { id: string })[],
  fromId: string,
  direction: ArrowDirection,
): string | undefined {
  const from = boxes.find((b) => b.id === fromId);
  if (!from) return undefined;
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  let best: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const box of boxes) {
    if (box.id === fromId) continue;
    const dx = box.x + box.width / 2 - cx;
    const dy = box.y + box.height / 2 - cy;
    const [primary, secondary] =
      direction === 'right'
        ? [dx, dy]
        : direction === 'left'
          ? [-dx, dy]
          : direction === 'down'
            ? [dy, dx]
            : [-dy, dx];
    if (primary <= 1) continue;
    const score = primary + Math.abs(secondary) * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = box.id;
    }
  }
  return best;
}

/** Where keyboard navigation starts without a selection: a highlighted box, else the top-left. */
export function startBox(
  boxes: (Rect & { id: string; highlight?: boolean })[],
): string | undefined {
  const highlighted = boxes.find((b) => b.highlight);
  if (highlighted) return highlighted.id;
  return [...boxes].sort((a, b) => a.y + a.x * 0.5 - (b.y + b.x * 0.5))[0]?.id;
}

/** True when a key event comes from a text field (shortcuts must not fire there). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

/** True for text fields and for controls that handle their own keys (buttons, links, menus). */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (isTypingTarget(target)) return true;
  return target instanceof Element && Boolean(target.closest('button, a[href], [role="menu"]'));
}
