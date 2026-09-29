import type { HTMLAttributes, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import type { GraphStatus } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { STATUS_VISUALS } from '../graph/visuals';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-border bg-surface-2 px-1 font-mono text-[10.5px] leading-none font-medium text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <LoaderCircle
      size={size}
      className={cn('animate-spin text-accent', className)}
      aria-label="Loading"
    />
  );
}

export type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-muted border-border',
  accent: 'bg-accent-soft text-accent border-transparent',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: LucideIcon;
}

export function Badge({ tone = 'neutral', icon: Icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {Icon ? <Icon size={11} /> : null}
      {children}
    </span>
  );
}

export function StatusIcon({
  status,
  size = 14,
  className,
}: {
  status: GraphStatus;
  size?: number;
  className?: string;
}) {
  const v = STATUS_VISUALS[status];
  const Icon = v.icon;
  return (
    <Icon
      size={size}
      aria-label={v.label}
      className={cn('shrink-0', v.className, v.spin && 'animate-spin', className)}
    />
  );
}

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn('flex flex-col items-center justify-center gap-2 p-8 text-center', className)}
    >
      {Icon ? (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-muted">
          <Icon size={20} />
        </div>
      ) : null}
      <div className="text-sm font-semibold text-fg">{title}</div>
      {description ? <div className="max-w-sm text-[13px] text-muted">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Thin horizontal/vertical divider. */
export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        vertical ? 'mx-1 h-5 w-px' : 'my-1 h-px w-full',
        'shrink-0 bg-border',
        className,
      )}
    />
  );
}
