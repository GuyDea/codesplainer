import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface InlineEditProps {
  value: string;
  onSubmit: (value: string) => void;
  /** Accessible label of the edit button / input. */
  label: string;
  maxLength?: number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}

/** Text that turns into an input on click / Enter. Enter or blur saves, Esc cancels. */
export function InlineEdit({
  value,
  onSubmit,
  label,
  maxLength = 200,
  placeholder,
  className,
  inputClassName,
  disabled,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    const next = draft.trim();
    if (next && next !== value) onSubmit(next);
    else setDraft(value);
  };

  if (editing) {
    return (
      <input
        ref={input}
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            input.current?.blur();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelled.current = true;
            input.current?.blur();
          }
        }}
        className={cn(
          'h-7 min-w-0 rounded-md border border-accent bg-surface px-1.5 text-[13px] font-medium text-fg outline-none ring-2 ring-accent/25',
          inputClassName,
        )}
      />
    );
  }

  return (
    <button
      type="button"
      title={disabled ? value : `${value} — click to rename`}
      aria-label={`${label}: ${value}`}
      disabled={disabled}
      onClick={() => setEditing(true)}
      className={cn(
        'h-7 min-w-0 truncate rounded-md px-1.5 text-left text-[13px] font-medium text-fg transition-colors hover:bg-surface-2 disabled:hover:bg-transparent',
        className,
      )}
    >
      {value || <span className="text-subtle">{placeholder}</span>}
    </button>
  );
}
