import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../lib/cn';
import { Tooltip } from './Tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'xs' | 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg hover:bg-accent-hover border-transparent shadow-card',
  secondary:
    'bg-surface text-fg border-border hover:bg-surface-2 hover:border-border-strong shadow-card',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-surface-2 hover:text-fg',
  subtle: 'bg-surface-2 text-fg border-transparent hover:bg-surface-3',
  danger: 'bg-danger text-white border-transparent hover:opacity-90 shadow-card',
};

const SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 px-2 text-xs gap-1 rounded-md',
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
};

const ICON_SIZES: Record<ButtonSize, number> = { xs: 12, sm: 14, md: 16 };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Icon after the label. */
  iconRight?: LucideIcon;
  loading?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary',
  size = 'sm',
  icon: Icon,
  iconRight: IconRight,
  loading,
  className,
  children,
  disabled,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZES[size];
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'inline-flex shrink-0 items-center justify-center border font-medium whitespace-nowrap transition-colors select-none',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle size={iconSize} className="animate-spin" />
      ) : Icon ? (
        <Icon size={iconSize} />
      ) : null}
      {children}
      {IconRight ? <IconRight size={iconSize} className="opacity-70" /> : null}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: LucideIcon;
  /** Accessible name; also shown as tooltip. */
  label: string;
  /** Optional shortcut hint shown in the tooltip, e.g. "M" or "Ctrl K". */
  shortcut?: string;
  variant?: 'ghost' | 'secondary' | 'subtle' | 'primary';
  size?: ButtonSize;
  active?: boolean;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
  ref?: Ref<HTMLButtonElement>;
}

const ICON_BUTTON_SIZES: Record<ButtonSize, string> = {
  xs: 'h-6 w-6 rounded-md',
  sm: 'h-7 w-7 rounded-md',
  md: 'h-9 w-9 rounded-lg',
};

export function IconButton({
  icon: Icon,
  label,
  shortcut,
  variant = 'ghost',
  size = 'sm',
  active,
  className,
  tooltipSide = 'bottom',
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        ref={ref}
        type={type}
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        className={cn(
          'inline-flex shrink-0 items-center justify-center border transition-colors',
          'disabled:pointer-events-none disabled:opacity-40',
          // Tailwind v4 does not resolve conflicting utilities by class order: pick one set.
          active ? 'border-transparent bg-accent-soft text-accent' : VARIANTS[variant],
          ICON_BUTTON_SIZES[size],
          className,
        )}
        {...rest}
      >
        <Icon size={ICON_SIZES[size] + (size === 'md' ? 2 : 0)} />
      </button>
    </Tooltip>
  );
}
