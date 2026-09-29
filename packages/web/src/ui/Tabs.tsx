import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Small trailing content (count badge...). */
  badge?: ReactNode;
  title?: string;
}

export interface TabsProps<T extends string> {
  value: T;
  items: TabItem<T>[];
  onChange: (value: T) => void;
  /** 'line' = underline tabs (panels), 'pill' = compact segmented look. */
  variant?: 'line' | 'pill';
  className?: string;
  'aria-label'?: string;
  /** Id prefix used for aria-controls / ids (tab panels use `${idPrefix}-panel-${value}`). */
  idPrefix?: string;
}

/** Accessible tab list (roving focus with arrow keys, Home/End). */
export function Tabs<T extends string>({
  value,
  items,
  onChange,
  variant = 'line',
  className,
  idPrefix,
  ...rest
}: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((i) => i.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const item = items[next];
    if (!item) return;
    onChange(item.value);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div
      ref={list}
      role="tablist"
      aria-label={rest['aria-label']}
      onKeyDown={onKeyDown}
      className={cn(
        // Borders/padding of the 'line' variant come from the caller (Tailwind v4 cannot
        // override conflicting utilities by class order).
        'flex items-center',
        variant === 'line' ? 'gap-1' : 'gap-0.5 rounded-lg bg-surface-2 p-0.5',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        const Icon = item.icon;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={idPrefix ? `${idPrefix}-tab-${item.value}` : undefined}
            aria-controls={idPrefix ? `${idPrefix}-panel-${item.value}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            title={item.title}
            onClick={() => onChange(item.value)}
            className={cn(
              'relative inline-flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              variant === 'line'
                ? cn(
                    'h-9 px-2',
                    selected
                      ? 'text-fg after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
                      : 'text-muted hover:text-fg',
                  )
                : cn(
                    'h-6 rounded-md px-2 text-xs',
                    selected ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
                  ),
            )}
          >
            {Icon ? <Icon size={14} className={selected ? 'text-accent' : undefined} /> : null}
            {item.label}
            {item.badge}
          </button>
        );
      })}
    </div>
  );
}
