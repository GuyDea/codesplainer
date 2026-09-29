/** Tiny presentational pieces shared by several panels. */
import { Fragment, useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/**
 * Inline title editor (autofocused, text selected): Enter saves, Esc cancels, blur saves.
 * `onDone(null)` means cancelled; `refocus` is true when finished from the keyboard.
 */
export function InlineRename({
  initial,
  onDone,
  label = 'Title',
  className,
}: {
  initial: string;
  onDone: (value: string | null, refocus: boolean) => void;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null, refocus: boolean) => {
    if (finished.current) return;
    finished.current = true;
    onDone(value, refocus);
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label={label}
      maxLength={160}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value, true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null, true);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value, false)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        'min-w-0 flex-1 rounded-md border border-accent bg-surface px-1.5 text-fg ring-2 ring-accent/20 outline-none',
        className,
      )}
    />
  );
}

/**
 * Classes for a toggled-on IconButton. Uses `!` because the button's variant classes would win
 * otherwise (Tailwind orders same-property utilities alphabetically; `cn` does not merge).
 */
export const ACTIVE_ICON_BUTTON = 'bg-accent-soft! text-accent!';

/** Titled block used by the inspectors ("Code", "Connections" ...). */
export function Section({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-t border-border px-1.5 pt-2.5 pb-2', className)}>
      <h3 className="flex h-5 items-center gap-1.5 px-1.5 pb-1 text-[11px] font-semibold tracking-wide text-subtle uppercase">
        <span>{title}</span>
        {count !== undefined ? (
          <span className="font-medium tabular-nums opacity-80">{count}</span>
        ) : null}
        {action ? <span className="ml-auto normal-case">{action}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Middle dot separated inline list (meta lines). */
export function DotList({ items, className }: { items: ReactNode[]; className?: string }) {
  const visible = items.filter((item) => item !== null && item !== undefined && item !== false);
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5', className)}>
      {visible.map((item, i) => (
        <Fragment key={i}>
          {i > 0 ? (
            <span aria-hidden className="text-subtle">
              ·
            </span>
          ) : null}
          {item}
        </Fragment>
      ))}
    </span>
  );
}

/** Split a filter string into lower-cased terms. */
export function filterTerms(filter: string | undefined): string[] {
  return (filter ?? '').toLowerCase().split(/\s+/).filter(Boolean);
}

/** Render `text` with every occurrence of `terms` wrapped in a subtle <mark>. */
export function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const marks: [number, number][] = [];
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      marks.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  if (!marks.length) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([m[0], m[1]]);
  }
  const out: ReactNode[] = [];
  let pos = 0;
  merged.forEach(([start, end], i) => {
    if (start > pos) out.push(text.slice(pos, start));
    out.push(
      <mark key={i} className="rounded-[3px] bg-accent-soft px-px text-accent">
        {text.slice(start, end)}
      </mark>,
    );
    pos = end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}
