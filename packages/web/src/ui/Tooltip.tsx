import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn';
import { Kbd } from './Misc';

export interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /** Delay before showing, ms. */
  delay?: number;
  disabled?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Lightweight tooltip: wraps children in an inline-flex span and shows a portal bubble on hover or
 * keyboard focus. No external positioning library.
 */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  delay = 350,
  disabled,
  children,
  className,
}: TooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const a = anchor.current.getBoundingClientRect();
    const b = bubble.current.getBoundingClientRect();
    const gap = 6;
    let left = a.left + a.width / 2 - b.width / 2;
    let top = side === 'top' ? a.top - b.height - gap : a.bottom + gap;
    if (side === 'left') {
      left = a.left - b.width - gap;
      top = a.top + a.height / 2 - b.height / 2;
    } else if (side === 'right') {
      left = a.right + gap;
      top = a.top + a.height / 2 - b.height / 2;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - b.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - b.height - 4));
    setPos({ left, top });
  }, [open, side]);

  return (
    <span
      ref={anchor}
      className={cn('inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onPointerDown={hide}
    >
      {children}
      {open && label
        ? createPortal(
            <div
              ref={bubble}
              role="tooltip"
              style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
              className="pointer-events-none fixed z-[1000] flex max-w-xs items-center gap-2 rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg shadow-pop animate-fade-in"
            >
              <span>{label}</span>
              {shortcut ? (
                <Kbd className="border-transparent bg-bg/20 text-bg">{shortcut}</Kbd>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}
