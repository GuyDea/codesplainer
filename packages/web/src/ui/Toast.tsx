import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, Info, X, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  /** ms before auto-dismiss; 0 = sticky. */
  duration: number;
}

export interface ToasterProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  className?: string;
}

const TONES: Record<ToastTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: 'text-accent' },
  success: { icon: CircleCheck, className: 'text-ok' },
  error: { icon: CircleAlert, className: 'text-danger' },
};

/** Bottom-right stack of transient notifications (hover pauses auto-dismiss). */
export function Toaster({ toasts, onDismiss, className }: ToasterProps) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      aria-live="polite"
      aria-relevant="additions"
      className={cn(
        'pointer-events-none fixed right-4 bottom-4 z-[950] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2',
        className,
      )}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    remaining.current = toast.duration;
  }, [toast.duration, toast.title]);

  useEffect(() => {
    if (!toast.duration || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(toast.id), Math.max(800, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [toast.id, toast.duration, toast.title, paused, onDismiss]);

  const tone = TONES[toast.tone];
  const Icon = tone.icon;
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-pop animate-pop-in"
    >
      <Icon size={16} className={cn('mt-px shrink-0', tone.className)} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug font-medium text-fg">{toast.title}</div>
        {toast.description ? (
          <div className="mt-0.5 line-clamp-4 text-xs break-words text-muted">
            {toast.description}
          </div>
        ) : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className="-my-0.5 shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-accent hover:bg-accent-soft"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="-mr-1 -mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-fg"
      >
        <X size={13} />
      </button>
    </div>
  );
}
