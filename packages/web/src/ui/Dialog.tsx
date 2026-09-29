import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../lib/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Disable closing via Esc / backdrop (e.g. while submitting). */
  dismissable?: boolean;
  className?: string;
  /** Element to focus on open (selector inside the dialog). Defaults to the first input/button. */
  initialFocus?: string;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

/** Stacked dialogs: only the top-most (last in the DOM, i.e. the visible one) reacts to Esc. */
function isTopMost(panel: HTMLElement | null): boolean {
  if (!panel) return false;
  const open = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  return open[open.length - 1] === panel;
}

/** Modal dialog in a portal. Esc and backdrop click close it; focus returns to the opener. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissable = true,
  className,
  initialFocus,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const el =
        (initialFocus ? panel.current?.querySelector<HTMLElement>(initialFocus) : null) ??
        panel.current?.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([hidden]):not([disabled]),textarea:not([disabled]),select:not([disabled]),[data-autofocus]',
        ) ??
        panel.current;
      el?.focus();
    }, 20);
    return () => {
      window.clearTimeout(t);
      opener.current?.focus?.();
    };
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open || !dismissable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!isTopMost(panel.current)) return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dismissable, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[800] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[10vh] backdrop-blur-[2px] animate-fade-in"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && dismissable) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={(e) => {
          // Keep Tab focus inside the dialog.
          if (e.key !== 'Tab' || !panel.current || !panel.current.contains(e.target as Node))
            return;
          const focusables = Array.from(
            panel.current.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null || el === document.activeElement);
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (!first || !last) return;
          if (
            e.shiftKey &&
            (document.activeElement === first || document.activeElement === panel.current)
          ) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        className={cn(
          'relative w-full rounded-xl border border-border bg-surface shadow-pop outline-none animate-pop-in',
          SIZES[size],
          className,
        )}
      >
        {title || dismissable ? (
          <div className="flex items-start gap-3 px-5 pt-4 pb-2">
            <div className="min-w-0 flex-1">
              {title ? (
                <h2 id={titleId} className="text-[15px] font-semibold text-fg">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-0.5 text-[13px] text-muted">
                  {description}
                </p>
              ) : null}
            </div>
            {dismissable ? (
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className="-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-fg"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="px-5 pb-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 rounded-b-xl border-t border-border bg-surface-2/60 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
