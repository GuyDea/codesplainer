import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

const FIELD =
  'w-full rounded-lg border border-border bg-surface text-fg placeholder:text-subtle transition-colors ' +
  'hover:border-border-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 ' +
  'disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: LucideIcon;
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({ icon: Icon, invalid, className, ref, ...rest }: InputProps) {
  return (
    <div className="relative w-full">
      {Icon ? (
        <Icon
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle"
        />
      ) : null}
      <input
        ref={ref}
        className={cn(
          FIELD,
          'h-8 px-2.5 text-[13px]',
          Icon && 'pl-8',
          invalid && 'border-danger',
          className,
        )}
        {...rest}
      />
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  ref?: Ref<HTMLTextAreaElement>;
}

export function Textarea({ className, ref, ...rest }: TextareaProps) {
  return (
    <textarea
      ref={ref}
      className={cn(FIELD, 'px-2.5 py-2 text-[13px] leading-snug', className)}
      {...rest}
    />
  );
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: { value: string; label: string; disabled?: boolean }[];
  ref?: Ref<HTMLSelectElement>;
}

export function Select({ options, className, ref, ...rest }: SelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className={cn(FIELD, 'h-8 appearance-none pr-7 pl-2.5 text-[13px]')}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-subtle"
      />
    </div>
  );
}

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
  id,
}: SwitchProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3',
        disabled && 'cursor-default opacity-50',
        className,
      )}
    >
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors',
          checked ? 'border-accent bg-accent' : 'border-border-strong bg-surface-3',
        )}
      >
        <span
          className={cn(
            'inline-block h-3 w-3 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[15px]' : 'translate-x-[2px]',
          )}
        />
      </button>
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-[13px] font-medium text-fg">{label}</span> : null}
          {description ? <span className="block text-xs text-muted">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  title?: string;
}

export interface SegmentedProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  size?: 'xs' | 'sm';
  className?: string;
  'aria-label'?: string;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'sm',
  className,
  ...rest
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={rest['aria-label']}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5',
        className,
      )}
    >
      {options.map((o) => {
        const Icon = o.icon;
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md font-medium transition-colors',
              size === 'xs' ? 'h-5 px-1.5 text-[11px]' : 'h-6 px-2 text-xs',
              selected ? 'bg-surface text-fg shadow-card' : 'text-muted hover:text-fg',
            )}
          >
            {Icon ? <Icon size={size === 'xs' ? 11 : 13} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs text-subtle">{hint}</span>
      ) : null}
    </div>
  );
}
