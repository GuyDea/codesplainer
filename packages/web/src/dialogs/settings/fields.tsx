import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Input, type InputProps } from '../../ui';
import { cn } from '../../lib/cn';

/** One settings row: label + hint on the left, control on the right. */
export function SettingRow({
  label,
  hint,
  children,
  htmlFor,
  stacked,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  /** Put the control under the label (wide inputs). */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex gap-x-6 gap-y-1.5 border-b border-border py-3 last:border-b-0',
        stacked ? 'flex-col' : 'items-center justify-between',
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-fg">
          {label}
        </label>
        {hint ? <div className="text-xs text-muted">{hint}</div> : null}
      </div>
      <div className={cn(stacked ? 'w-full' : 'shrink-0')}>{children}</div>
    </div>
  );
}

export interface DraftInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  value: string;
  /** Called (debounced) while typing, and on blur / Enter. */
  onCommit: (value: string) => void;
  debounceMs?: number;
  /** Classes of a wrapping element (use it for widths; the input itself is full width). */
  containerClassName?: string;
}

/**
 * Text input with a local draft: typing never gets overwritten by the (optimistic) store value,
 * commits are debounced, and outside changes apply when the field is not focused.
 */
export function DraftInput({
  value,
  onCommit,
  debounceMs = 500,
  onBlur,
  onFocus,
  onKeyDown,
  containerClassName,
  ...rest
}: DraftInputProps) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef(onCommit);
  useLayoutEffect(() => {
    latest.current = onCommit;
  });

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const commitNow = (next: string) => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (next !== value) latest.current(next);
  };

  return (
    <div className={containerClassName}>
      <Input
        {...rest}
        value={draft}
        onFocus={(e) => {
          focused.current = true;
          onFocus?.(e);
        }}
        onBlur={(e) => {
          focused.current = false;
          commitNow(draft);
          onBlur?.(e);
        }}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => latest.current(next), debounceMs);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commitNow(draft);
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}

/** Integer input that only commits valid values within [min, max]. */
export function NumberInput({
  value,
  min,
  max,
  onCommit,
  className,
  id,
  'aria-label': ariaLabel,
  suffix,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
  suffix?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  const parsed = Number.parseInt(draft, 10);
  const valid =
    Number.isFinite(parsed) && parsed >= min && parsed <= max && String(parsed) === draft.trim();

  const commit = () => {
    if (valid && parsed !== value) onCommit(parsed);
    else if (!valid) setDraft(String(value));
  };

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="w-24">
        <Input
          id={id}
          aria-label={ariaLabel}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={draft}
          invalid={!valid}
          onFocus={() => {
            focused.current = true;
          }}
          onBlur={() => {
            focused.current = false;
            commit();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            const next = Number.parseInt(e.target.value, 10);
            if (
              Number.isFinite(next) &&
              next >= min &&
              next <= max &&
              String(next) === e.target.value.trim()
            ) {
              if (next !== value) onCommit(next);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          className="tabular-nums"
        />
      </div>
      {suffix ? <span className="text-xs text-muted">{suffix}</span> : null}
    </div>
  );
}
