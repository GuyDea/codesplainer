import { useState } from 'react';
import {
  Check,
  ChevronDown,
  Copy,
  RefreshCw,
  RotateCcw,
  Settings,
  SquareTerminal,
  Trash2,
} from 'lucide-react';
import { graphDisplayTitle } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { Button, IconButton, Menu, StatusIcon, type MenuItem } from '../ui';
import { DotOk } from './helpers';
import { useCopy } from './hooks';
import type { ErrorViewProps } from './types';

/** Errors that are usually fixed in settings (provider setup, sign-in, sandbox). */
export const SETTINGS_ERROR_PATTERN =
  /sandbox|auth|log ?in|sign ?in|unavailable|not found|not installed|credential|api key|permission denied|ENOENT/i;

const LONG_CHARS = 360;
const LONG_LINES = 6;

/** Shown instead of the canvas for failed / cancelled diagrams. Fills and centers in its parent. */
export function ErrorView({
  graph,
  providers,
  onRetry,
  onDelete,
  onShowRaw,
  onOpenSettings,
  className,
}: ErrorViewProps) {
  const cancelled = graph.status === 'cancelled';
  const message = graph.error?.trim() ?? '';
  const long = message.length > LONG_CHARS || message.split('\n').length > LONG_LINES;
  const [expanded, setExpanded] = useState(false);
  const [copied, copy] = useCopy();
  const others = providers.filter((p) => p.enabled && p.available && p.id !== graph.provider);
  const canFork = graph.origin.type !== 'question';
  const settingsHint = Boolean(onOpenSettings) && SETTINGS_ERROR_PATTERN.test(message);

  const retryWith: MenuItem[] = others.map((p) => ({
    id: p.id,
    label: p.name,
    icon: DotOk,
    onSelect: () => onRetry({ provider: p.id }),
  }));

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto p-8',
        className,
      )}
    >
      <div className="flex w-full max-w-lg flex-col items-center gap-3 text-center">
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-xl',
            cancelled ? 'bg-surface-2' : 'bg-danger-soft',
          )}
        >
          <StatusIcon status={graph.status} size={22} />
        </div>
        <div className="flex flex-col items-center gap-0.5">
          <h2 className="text-[15px] font-semibold text-fg">
            {cancelled ? 'Cancelled' : 'Failed'}
          </h2>
          <p className="line-clamp-2 max-w-md text-[13px] text-muted">{graphDisplayTitle(graph)}</p>
        </div>

        {message ? (
          <div className="group relative mt-1 w-full text-left">
            <pre
              className={cn(
                'overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 pr-9 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap text-fg',
                long && !expanded && 'max-h-36 overflow-hidden',
              )}
            >
              {message}
            </pre>
            {long && !expanded ? (
              <div className="pointer-events-none absolute inset-x-px bottom-px h-12 rounded-b-lg bg-linear-to-t from-surface-2 to-transparent" />
            ) : null}
            <div className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              <IconButton
                icon={copied ? Check : Copy}
                label={copied ? 'Copied' : 'Copy message'}
                size="xs"
                onClick={() => copy(message)}
              />
            </div>
            {long ? (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg"
              >
                <ChevronDown
                  size={13}
                  className={cn('transition-transform', expanded && 'rotate-180')}
                />
                {expanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
          <Button variant="primary" icon={RotateCcw} onClick={() => onRetry({})}>
            Retry
          </Button>
          {canFork ? (
            <Button icon={RefreshCw} onClick={() => onRetry({ fresh: true })}>
              Retry fresh
            </Button>
          ) : null}
          {retryWith.length ? (
            <Menu items={retryWith} align="start">
              <Button iconRight={ChevronDown}>Retry with…</Button>
            </Menu>
          ) : null}
          {onShowRaw ? (
            <Button variant="ghost" icon={SquareTerminal} onClick={onShowRaw}>
              Show raw output
            </Button>
          ) : null}
          {settingsHint && onOpenSettings ? (
            <Button variant="ghost" icon={Settings} onClick={onOpenSettings}>
              Open settings
            </Button>
          ) : null}
          <Button
            variant="ghost"
            icon={Trash2}
            onClick={onDelete}
            className="text-danger! hover:bg-danger-soft!"
          >
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
