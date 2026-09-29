/** Small React hooks shared by the panels. */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { copyText } from './helpers';

/** Current time (ms), re-rendering every `intervalMs` while `enabled`. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

/** Copy to clipboard with a short-lived "copied" flag for feedback (check icon). */
export function useCopy(resetMs = 1400): [string | null, (text: string, id?: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback(
    (text: string, id = 'default') => {
      void copyText(text).then((ok) => {
        if (!ok) return;
        setCopied(id);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), resetMs);
      });
    },
    [resetMs],
  );
  return [copied, copy];
}

// ---- roving-focus tree keyboard navigation ---------------------------------------------------

export interface TreeNavRow {
  id: string;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
}

export interface TreeNavOptions {
  /** Row to focus by default (e.g. the active item). */
  preferredId?: string | null;
  onActivate: (id: string) => void;
  onToggle: (id: string, expanded: boolean) => void;
  /** Extra keys for the focused row; return true when handled. */
  onKey?: (id: string, event: KeyboardEvent<HTMLElement>) => boolean;
}

/**
 * WAI-ARIA tree keyboard model over a flat list of visible rows: ↑/↓ Home/End move, → expands or
 * enters, ← collapses or goes to the parent, Enter activates. Rows must carry `data-row-id`.
 */
export function useTreeNav(rows: TreeNavRow[], options: TreeNavOptions) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());

  const effectiveId =
    (focusId && rows.some((r) => r.id === focusId) ? focusId : null) ??
    (options.preferredId && rows.some((r) => r.id === options.preferredId)
      ? options.preferredId
      : null) ??
    rows[0]?.id ??
    null;

  const register = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) elements.current.set(id, el);
      else elements.current.delete(id);
    },
    [],
  );

  const focusRow = useCallback((id: string) => {
    setFocusId(id);
    const el = elements.current.get(id);
    if (el) {
      el.focus({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest' });
    }
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Only keys pressed on a row itself count (not inputs/buttons inside it, nor portaled menus).
    const id = (event.target as HTMLElement).dataset?.rowId;
    if (!id) return;
    const index = rows.findIndex((r) => r.id === id);
    const row = rows[index];
    if (!row) return;
    if (options.onKey?.(id, event)) return;
    const move = (to: TreeNavRow | undefined) => {
      if (!to) return;
      event.preventDefault();
      focusRow(to.id);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(rows[index + 1]);
        break;
      case 'ArrowUp':
        move(rows[index - 1]);
        break;
      case 'Home':
        move(rows[0]);
        break;
      case 'End':
        move(rows[rows.length - 1]);
        break;
      case 'ArrowRight':
        event.preventDefault();
        if (row.hasChildren && !row.expanded) options.onToggle(row.id, true);
        else if (row.hasChildren && rows[index + 1]?.parentId === row.id) move(rows[index + 1]);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (row.hasChildren && row.expanded) options.onToggle(row.id, false);
        else if (row.parentId) move(rows.find((r) => r.id === row.parentId));
        break;
      case 'Enter':
        event.preventDefault();
        options.onActivate(row.id);
        break;
      default:
        break;
    }
  };

  const elementOf = useCallback((id: string) => elements.current.get(id), []);

  return { focusId: effectiveId, setFocusId, focusRow, register, elementOf, onKeyDown };
}
