import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, Logs } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button, EmptyState, Tooltip } from '../ui';
import {
  ACTIVITY_VISUALS,
  activityCategory,
  activityKeys,
  formatClock,
  shortPath,
} from './helpers';
import type { ActivityLogProps } from './types';

/** Distance from the bottom (px) that still counts as "following" the log. */
const STICKY_PX = 32;
const LONG_TEXT = 320;

/**
 * Agent activity (tool calls, messages, warnings). Scrolls itself: give it a bounded height
 * (h-full in a sized parent, or max-h-*). When `live`, it follows new items unless scrolled up.
 */
export function ActivityLog({ items, live, className }: ActivityLogProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [detached, setDetached] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const keys = useMemo(() => activityKeys(items), [items]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !live || !follow.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items, live]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= STICKY_PX;
    follow.current = atBottom;
    setDetached(!atBottom);
  };

  const jumpToLatest = () => {
    const el = scroller.current;
    if (!el) return;
    follow.current = true;
    setDetached(false);
    if (typeof el.scrollTo === 'function')
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
  };

  if (!items.length) {
    return <EmptyState icon={Logs} title="No activity yet" className={cn('h-full', className)} />;
  }

  return (
    <div
      ref={scroller}
      role="log"
      aria-label="Activity log"
      aria-live="off"
      tabIndex={0}
      onScroll={onScroll}
      className={cn(
        'relative min-h-0 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-inset',
        className,
      )}
    >
      <ol className="flex flex-col py-1.5">
        {items.map((item, index) => {
          const key = keys[index] ?? String(index);
          const category = activityCategory(item.kind, item.text);
          const visual = ACTIVITY_VISUALS[category];
          const Icon = visual.icon;
          const long = item.text.length > LONG_TEXT || item.text.split('\n').length > 4;
          const open = expanded.has(key);
          return (
            <li
              key={key}
              className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-2 px-3 py-[3px] text-[12.5px] leading-5 hover:bg-surface-2/60"
            >
              <time dateTime={item.ts} className="font-mono text-[11px] text-subtle tabular-nums">
                {formatClock(item.ts)}
              </time>
              <span className="flex h-5 items-center">
                <Icon size={13} aria-label={visual.label} className={visual.className} />
              </span>
              <div className="min-w-0">
                <span
                  className={cn(
                    'break-words whitespace-pre-wrap',
                    category === 'thinking' ? 'text-muted italic' : 'text-fg',
                    category === 'error' && 'text-danger',
                    category === 'warning' && 'text-warn',
                    long && !open && 'line-clamp-4',
                  )}
                >
                  {item.text}
                </span>
                {long ? (
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      })
                    }
                    className="text-[11.5px] font-medium text-accent hover:underline"
                  >
                    {open ? 'Less' : 'More'}
                  </button>
                ) : null}
                {item.path && !item.text.includes(item.path) ? (
                  <Tooltip label={item.path} disabled={shortPath(item.path) === item.path}>
                    <span className="ml-1.5 inline-flex h-[18px] max-w-full items-center truncate rounded bg-surface-2 px-1.5 align-middle font-mono text-[11px] text-muted">
                      {shortPath(item.path)}
                    </span>
                  </Tooltip>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {live && detached ? (
        <div className="pointer-events-none sticky bottom-2 flex justify-end px-2">
          <Button
            size="xs"
            icon={ArrowDown}
            onClick={jumpToLatest}
            className="pointer-events-auto shadow-pop"
          >
            Latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
