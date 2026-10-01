import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  ChevronDown,
  Gauge,
  LoaderCircle,
  Pencil,
  SlidersHorizontal,
  Zap,
} from 'lucide-react';
import {
  DETAIL_LEVELS,
  DETAIL_LEVEL_INFO,
  PROVIDER_LABELS,
  PROVIDER_RUN_OPTIONS,
  truncate,
  type DetailLevel,
} from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { Button, IconButton, Menu, Segmented, Tooltip, type MenuItem } from '../ui';
import {
  DotOff,
  DotOk,
  SCOPE_ICONS,
  scopeChipLabel,
  scopeKey,
  scopeLabel,
  scopePlaceholder,
} from './helpers';
import { ACTIVE_ICON_BUTTON } from './parts';
import type { AskBarProps } from './types';

const MAX_ROWS = 6;
/** Below this width (px) the detail control collapses into a menu. */
const COMPACT_WIDTH = 540;

const DETAIL_HINT = (d: DetailLevel) =>
  `${DETAIL_LEVEL_INFO[d].min}–${DETAIL_LEVEL_INFO[d].max} boxes`;

/**
 * Question input with scope, agent, model, effort, fast mode and detail pickers. Enter sends, Shift+Enter adds a
 * line, Esc blurs. 'bar' fits a bottom bar (menus open upwards); 'hero' is a large centered card
 * (max-w-2xl) for the workspace home.
 */
export function AskBar({
  scope,
  scopes,
  onScopeChange,
  providers,
  provider,
  model,
  detail,
  onProviderChange,
  onModelChange,
  onDetailChange,
  effort = '',
  defaultEffort = '',
  fast = false,
  onEffortChange,
  onFastChange,
  onSubmit,
  busy,
  focusSignal,
  draft,
  variant = 'bar',
  placeholder,
  autoFocus,
  className,
}: AskBarProps) {
  const hero = variant === 'hero';
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [customModel, setCustomModel] = useState<string | null>(null);
  const [compact, setCompact] = useState(false);
  const root = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = Boolean(busy) || submitting;
  const canSend = text.trim().length > 0 && !pending;
  const menuSide = hero ? 'bottom' : 'top';

  // ---- auto-grow (1-6 lines; hero starts at 2) ----
  const minRows = hero ? 2 : 1;
  const resize = useCallback(() => {
    const el = input.current;
    if (!el) return;
    const cs = window.getComputedStyle(el);
    const line = Number.parseFloat(cs.lineHeight) || (hero ? 24 : 20);
    const pad =
      (Number.parseFloat(cs.paddingTop) || 0) + (Number.parseFloat(cs.paddingBottom) || 0);
    const max = line * MAX_ROWS + pad;
    const min = line * minRows + pad;
    el.style.height = 'auto';
    const content = el.scrollHeight;
    el.style.height = `${Math.min(Math.max(content, min), max)}px`;
    el.style.overflowY = content > max ? 'auto' : 'hidden';
  }, [hero, minRows]);
  useLayoutEffect(resize, [text, resize]);

  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      setCompact(el.clientWidth > 0 && el.clientWidth < COMPACT_WIDTH);
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);

  // ---- focus / draft signals ----
  useEffect(() => {
    if (autoFocus) input.current?.focus();
    // Only on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastSignal = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === lastSignal.current) return;
    lastSignal.current = focusSignal;
    input.current?.focus();
  }, [focusSignal]);

  const lastNonce = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!draft || draft.nonce === lastNonce.current) return;
    lastNonce.current = draft.nonce;
    setText(draft.text);
    const el = input.current;
    if (!el) return;
    el.focus();
    const end = draft.text.length;
    window.requestAnimationFrame(() => el.setSelectionRange(end, end));
  }, [draft]);

  // ---- submit ----
  const submit = () => {
    const question = text.trim();
    if (!question || pending) return;
    let result: void | Promise<void>;
    try {
      result = onSubmit(question);
    } catch {
      return;
    }
    setText('');
    if (result instanceof Promise) {
      setSubmitting(true);
      result
        .catch(() => setText((current) => (current ? current : question)))
        .finally(() => setSubmitting(false));
    }
  };

  // ---- scope ----
  const currentKey = scopeKey(scope);
  const ScopeIcon = SCOPE_ICONS[scope.type];
  const showScope = scopes.length > 1 || scope.type !== 'new';
  const scopeItems: MenuItem[] = scopes.map((s) => ({
    id: scopeKey(s),
    label: scopeLabel(s),
    icon: SCOPE_ICONS[s.type],
    checked: scopeKey(s) === currentKey,
    onSelect: () => onScopeChange(s),
  }));
  const chipClass = cn(
    'inline-flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
    compact ? 'max-w-[9rem]' : 'max-w-[15rem]',
    scope.type === 'new'
      ? 'bg-surface-2 text-muted hover:text-fg'
      : 'bg-accent-soft text-accent hover:bg-accent-soft/70',
  );
  const chipContent = (
    <>
      <ScopeIcon size={12} aria-hidden className="shrink-0" />
      <span className="truncate">{scopeChipLabel(scope)}</span>
    </>
  );
  const scopeControl = !showScope ? null : scopes.length > 1 ? (
    <Menu items={scopeItems} side={menuSide} minWidth={240} className="min-w-0">
      <button
        type="button"
        aria-label={`Scope: ${scopeLabel(scope)}`}
        aria-haspopup="menu"
        className={cn(
          chipClass,
          'focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
        )}
      >
        {chipContent}
        <ChevronDown size={12} aria-hidden className="shrink-0 opacity-70" />
      </button>
    </Menu>
  ) : (
    <Tooltip label={scopeLabel(scope)} className="min-w-0">
      <span className={chipClass}>{chipContent}</span>
    </Tooltip>
  );

  // ---- provider ----
  const enabled = providers.filter((p) => p.enabled);
  const current = providers.find((p) => p.id === provider);
  const providerItems: MenuItem[] = [
    { type: 'label', id: 'label', label: 'Agent' },
    ...enabled.map((p): MenuItem => ({
      id: p.id,
      label: p.name,
      icon: p.available ? DotOk : DotOff,
      checked: p.id === provider,
      disabled: !p.available,
      hint: p.available
        ? p.experimental
          ? 'Beta'
          : undefined
        : truncate(p.reason ?? 'Unavailable', 34),
      onSelect: () => onProviderChange(p.id),
    })),
  ];
  if (!enabled.length) {
    providerItems.push({
      id: 'none',
      label: 'No agents enabled',
      disabled: true,
      onSelect: () => undefined,
    });
  }

  // ---- model ----
  const models = current?.models ?? [];
  const modelName = model ? (models.find((m) => m.id === model)?.label ?? model) : 'Default';
  const defaultName = current?.defaultModel
    ? (models.find((m) => m.id === current.defaultModel)?.label ?? current.defaultModel)
    : undefined;
  const modelItems: MenuItem[] = [
    { type: 'label', id: 'label', label: 'Model' },
    {
      id: 'default',
      label: 'Default',
      hint: defaultName ? truncate(defaultName, 26) : undefined,
      checked: !model,
      onSelect: () => onModelChange(''),
    },
    ...models.map((m): MenuItem => ({
      id: `model:${m.id}`,
      label: m.label,
      checked: model === m.id,
      onSelect: () => onModelChange(m.id),
    })),
    ...(model && !models.some((m) => m.id === model)
      ? [{ id: 'custom-current', label: model, checked: true, onSelect: () => undefined }]
      : []),
    { type: 'separator', id: 'sep' },
    { id: 'custom', label: 'Custom model…', icon: Pencil, onSelect: () => setCustomModel(model) },
  ];

  // ---- effort / fast ----
  const runOptions = PROVIDER_RUN_OPTIONS[provider];
  const showEffort = Boolean(onEffortChange) && runOptions.efforts.length > 0;
  const showFast = Boolean(onFastChange) && runOptions.fast;
  const effortItems: MenuItem[] = [
    { type: 'label', id: 'label', label: 'Effort' },
    {
      id: 'default',
      label: 'Default',
      hint: defaultEffort || undefined,
      checked: !effort,
      onSelect: () => onEffortChange?.(''),
    },
    ...runOptions.efforts.map((e): MenuItem => ({
      id: `effort:${e}`,
      label: e,
      checked: effort === e,
      onSelect: () => onEffortChange?.(e),
    })),
  ];
  // "Effort" rather than "Default" next to the model picker, which already says "Default".
  const effortName = effort || 'Effort';

  const detailItems: MenuItem[] = [
    { type: 'label', id: 'label', label: 'Detail' },
    ...DETAIL_LEVELS.map((d): MenuItem => ({
      id: d,
      label: DETAIL_LEVEL_INFO[d].label,
      hint: DETAIL_HINT(d),
      checked: d === detail,
      onSelect: () => onDetailChange(d),
    })),
  ];

  const commitCustom = (value: string | null) => {
    setCustomModel(null);
    if (value === null) return;
    const next = value.trim();
    if (next !== model) onModelChange(next);
  };

  return (
    <form
      ref={root}
      aria-label="Ask a question"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        'flex w-full min-w-0 flex-col border border-border bg-surface transition-[border-color,box-shadow]',
        'focus-within:border-accent/60 focus-within:ring-4 focus-within:ring-accent/10',
        hero ? 'mx-auto max-w-2xl rounded-2xl shadow-card' : 'rounded-xl shadow-card',
        className,
      )}
    >
      <textarea
        ref={input}
        rows={minRows}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder ?? scopePlaceholder(scope)}
        aria-label="Question"
        spellCheck
        className={cn(
          'block w-full resize-none bg-transparent text-fg placeholder:text-subtle focus:outline-none',
          hero
            ? 'px-4 pt-3.5 pb-1 text-[15px] leading-6'
            : 'px-3 pt-2.5 pb-1 text-[13.5px] leading-5',
        )}
      />
      <div className={cn('flex min-w-0 items-center gap-1', hero ? 'px-3 pb-3' : 'px-2 pb-2')}>
        {scopeControl}
        <div className="ml-auto flex min-w-0 shrink items-center gap-0.5">
          <Menu
            items={providerItems}
            side={menuSide}
            align="end"
            minWidth={240}
            className="min-w-0"
          >
            <Tooltip
              label={
                current?.available === false
                  ? `Unavailable: ${current.reason ?? 'not detected'}`
                  : 'Agent'
              }
              className="min-w-0"
            >
              <Button
                variant="ghost"
                size="xs"
                icon={current?.available === false ? DotOff : DotOk}
                iconRight={ChevronDown}
                aria-haspopup="menu"
                className={cn('min-w-0 shrink!', compact ? 'max-w-[7.5rem]' : 'max-w-[10rem]')}
              >
                <span className="min-w-0 truncate">
                  {current?.name ?? PROVIDER_LABELS[provider]}
                </span>
              </Button>
            </Tooltip>
          </Menu>

          {customModel !== null ? (
            <CustomModelInput initial={customModel} onDone={commitCustom} />
          ) : (
            <Menu items={modelItems} side={menuSide} align="end" minWidth={220} className="min-w-0">
              <Tooltip label="Model" className="min-w-0">
                <Button
                  variant="ghost"
                  size="xs"
                  iconRight={ChevronDown}
                  aria-haspopup="menu"
                  className={cn('min-w-0 shrink!', compact ? 'max-w-[6.5rem]' : 'max-w-[9rem]')}
                >
                  <span className="min-w-0 truncate">{modelName}</span>
                </Button>
              </Tooltip>
            </Menu>
          )}

          {showEffort ? (
            <Menu items={effortItems} side={menuSide} align="end" minWidth={180}>
              <Tooltip label={`Effort: ${effort || defaultEffort || 'default'}`}>
                <Button
                  variant="ghost"
                  size="xs"
                  icon={Gauge}
                  iconRight={compact ? undefined : ChevronDown}
                  aria-label={`Effort: ${effort || 'Default'}`}
                  aria-haspopup="menu"
                  className={cn(effort && 'text-accent')}
                >
                  {compact ? null : effortName}
                </Button>
              </Tooltip>
            </Menu>
          ) : null}

          {showFast ? (
            <IconButton
              icon={Zap}
              label={fast ? 'Fast mode: on (faster, costs more)' : 'Fast mode: off'}
              aria-pressed={fast}
              active={fast}
              size="sm"
              tooltipSide={hero ? 'bottom' : 'top'}
              onClick={() => onFastChange?.(!fast)}
              className={cn(fast && ACTIVE_ICON_BUTTON)}
            />
          ) : null}

          {compact ? (
            <Menu items={detailItems} side={menuSide} align="end">
              <Tooltip label="Detail">
                <Button
                  variant="ghost"
                  size="xs"
                  icon={SlidersHorizontal}
                  iconRight={ChevronDown}
                  aria-haspopup="menu"
                >
                  {DETAIL_LEVEL_INFO[detail].label}
                </Button>
              </Tooltip>
            </Menu>
          ) : (
            <Segmented<DetailLevel>
              size="xs"
              value={detail}
              onChange={onDetailChange}
              aria-label="Detail"
              className="mx-1 shrink-0"
              options={DETAIL_LEVELS.map((d) => ({
                value: d,
                label: DETAIL_LEVEL_INFO[d].label,
                title: DETAIL_HINT(d),
              }))}
            />
          )}

          <IconButton
            type="submit"
            icon={pending ? LoaderCircle : ArrowUp}
            label={pending ? 'Asking…' : 'Ask'}
            shortcut="Enter"
            variant="primary"
            size={hero ? 'md' : 'sm'}
            tooltipSide={hero ? 'bottom' : 'top'}
            disabled={!canSend}
            className={cn('ml-0.5', pending && 'disabled:opacity-100! [&_svg]:animate-spin')}
          />
        </div>
      </div>
    </form>
  );
}

/** Inline input for a custom model id: Enter/blur applies, Esc cancels. */
function CustomModelInput({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (value: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Custom model id"
      placeholder="model-id"
      spellCheck={false}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-6 w-36 rounded-md border border-accent bg-surface px-2 font-mono text-[11.5px] text-fg ring-2 ring-accent/20 outline-none"
    />
  );
}
