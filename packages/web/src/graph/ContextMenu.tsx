/** Right-click menu at a screen position (portal). Arrow keys move, Enter selects, Esc closes. */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { Kbd, type MenuItem } from '../ui';

type ActionItem = Extract<MenuItem, { onSelect: () => void }>;

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  /** Accessible name of the menu. */
  label?: string;
}

function isAction(item: MenuItem | undefined): item is ActionItem {
  return Boolean(item) && (item?.type ?? 'item') === 'item';
}

export function ContextMenu({ x, y, items, onClose, label }: ContextMenuProps) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const firstEnabled = items.findIndex((i) => isAction(i) && !i.disabled);
  const [active, setActive] = useState(firstEnabled);

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4));
    const top = Math.max(4, y + r.height > window.innerHeight - 4 ? y - r.height : y);
    setPos({ left, top });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!panel.current?.contains(e.target as Node)) onClose();
    };
    const close = () => onClose();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    window.addEventListener('wheel', close, { passive: true, capture: true });
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('wheel', close, { capture: true });
    };
  }, [onClose]);

  const choose = (index: number) => {
    const item = items[index];
    if (!isAction(item) || item.disabled) return;
    onClose();
    item.onSelect();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    const enabled = items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => isAction(item) && !item.disabled)
      .map(({ index }) => index);
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!enabled.length) return;
      const at = enabled.indexOf(active);
      const next =
        e.key === 'ArrowDown'
          ? enabled[(at + 1) % enabled.length]
          : enabled[(at - 1 + enabled.length) % enabled.length];
      setActive(next ?? -1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    }
  };

  return createPortal(
    <div
      ref={panel}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos?.left ?? x, top: pos?.top ?? y, visibility: pos ? 'visible' : 'hidden' }}
      className="fixed z-[900] min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-pop outline-none animate-pop-in"
    >
      {items.map((item, index) => {
        if (item.type === 'separator') return <div key={item.id} className="my-1 h-px bg-border" />;
        if (item.type === 'label') {
          return (
            <div
              key={item.id}
              className="truncate px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase"
            >
              {item.label}
            </div>
          );
        }
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
              active === index &&
                !item.disabled &&
                (item.danger ? 'bg-danger-soft' : 'bg-surface-2'),
            )}
          >
            <span className="flex w-4 shrink-0 justify-center">
              {Icon ? <Icon size={14} className="opacity-80" /> : null}
            </span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.hint ? <span className="text-xs text-subtle">{item.hint}</span> : null}
            {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
