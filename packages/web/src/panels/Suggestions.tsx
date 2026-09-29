import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip } from '../ui';
import type { SuggestionsProps } from './types';

const FADE = 20;

/** Follow-up question chips; horizontally scrollable, edges fade while more is hidden. */
export function Suggestions({ suggestions, onPick, className }: SuggestionsProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, suggestions]);

  if (!suggestions.length) return null;

  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? 'transparent' : '#000'} 0, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.right ? 'transparent' : '#000'} 100%)`
      : undefined;
  const style: CSSProperties | undefined = mask
    ? { maskImage: mask, WebkitMaskImage: mask }
    : undefined;

  return (
    <div
      ref={scroller}
      role="list"
      aria-label="Suggested questions"
      onScroll={measure}
      onWheel={(e) => {
        const el = scroller.current;
        if (!el || el.scrollWidth <= el.clientWidth) return;
        if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
      }}
      style={style}
      className={cn(
        'flex min-w-0 items-center gap-1.5 overflow-x-auto py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {suggestions.map((question, i) => (
        <div role="listitem" key={`${i}:${question}`} className="shrink-0">
          <Tooltip label={question} disabled={question.length <= 48} delay={500}>
            <button
              type="button"
              onClick={() => onPick(question)}
              className={cn(
                'inline-flex h-7 max-w-[22rem] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5',
                'text-[12.5px] text-muted shadow-card transition-colors',
                'hover:border-border-strong hover:bg-surface-2 hover:text-fg',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
              )}
            >
              <Sparkles size={12} aria-hidden className="shrink-0 text-accent" />
              <span className="truncate">{question}</span>
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
