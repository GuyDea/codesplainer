import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import { cn } from '../lib/cn';
import { Kbd } from './Misc';

export type MenuItem =
  | {
      type?: 'item';
      id: string;
      label: string;
      icon?: LucideIcon;
      shortcut?: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string };

export interface MenuProps {
  items: MenuItem[];
  /** The trigger element (usually a Button/IconButton). Clicking it toggles the menu. */
  children: ReactNode;
  align?: 'start' | 'end';
  side?: 'bottom' | 'top';
  className?: string;
  /** Minimum menu width in px. */
  minWidth?: number;
  onOpenChange?: (open: boolean) => void;
}

/** Click-to-open dropdown menu rendered in a portal. Arrow keys move, Enter selects, Esc closes. */
export function Menu({
  items,
  children,
  align = 'start',
  side = 'bottom',
  className,
  minWidth = 180,
  onOpenChange,
}: MenuProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpenState] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);

  const setOpen = useCallback(
    (value: boolean) => {
      setOpenState(value);
      onOpenChange?.(value);
      if (!value) {
        setPos(null);
        setActive(-1);
      }
    },
    [onOpenChange],
  );

  const selectable = items
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) => (item.type ?? 'item') === 'item' && !(item as { disabled?: boolean }).disabled,
    );

  useLayoutEffect(() => {
    if (!open || !anchor.current || !panel.current) return;
    const a = anchor.current.getBoundingClientRect();
    const p = panel.current.getBoundingClientRect();
    let left = align === 'end' ? a.right - p.width : a.left;
    let top = side === 'top' ? a.top - p.height - 4 : a.bottom + 4;
    if (top + p.height > window.innerHeight - 4) top = Math.max(4, a.top - p.height - 4);
    left = Math.max(4, Math.min(left, window.innerWidth - p.width - 4));
    setPos({ left, top });
    panel.current.focus();
  }, [open, align, side]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, setOpen]);

  const choose = (index: number) => {
    const item = items[index];
    if (!item || (item.type ?? 'item') !== 'item') return;
    const it = item as Extract<MenuItem, { onSelect: () => void }>;
    if (it.disabled) return;
    setOpen(false);
    anchor.current?.querySelector<HTMLElement>('button,[tabindex]')?.focus();
    it.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      anchor.current?.querySelector<HTMLElement>('button,[tabindex]')?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!selectable.length) return;
      const pos = selectable.findIndex((s) => s.index === active);
      const next =
        e.key === 'ArrowDown'
          ? selectable[(pos + 1) % selectable.length]
          : selectable[(pos - 1 + selectable.length) % selectable.length];
      setActive(next?.index ?? -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (active >= 0) choose(active);
    }
  };

  return (
    <>
      <span
        ref={anchor}
        className={cn('inline-flex', className)}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <div
              ref={panel}
              role="menu"
              tabIndex={-1}
              onKeyDown={onKeyDown}
              style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, minWidth }}
              className="fixed z-[900] max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface p-1 shadow-pop outline-none animate-pop-in"
            >
              {items.map((item, index) => {
                if (item.type === 'separator')
                  return <div key={item.id} className="my-1 h-px bg-border" />;
                if (item.type === 'label')
                  return (
                    <div
                      key={item.id}
                      className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase"
                    >
                      {item.label}
                    </div>
                  );
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                      'disabled:cursor-default disabled:opacity-40',
                      item.danger ? 'text-danger' : 'text-fg',
                      active === index && (item.danger ? 'bg-danger-soft' : 'bg-surface-2'),
                    )}
                  >
                    <span className="flex w-4 shrink-0 justify-center">
                      {item.checked ? (
                        <Check size={14} />
                      ) : Icon ? (
                        <Icon size={14} className="opacity-80" />
                      ) : null}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.hint ? <span className="text-xs text-subtle">{item.hint}</span> : null}
                    {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
