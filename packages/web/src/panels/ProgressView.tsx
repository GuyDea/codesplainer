import { useMemo } from 'react';
import { CircleStop, Clock, Files } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button, Spinner } from '../ui';
import { useNow } from './hooks';
import {
  ACTIVITY_VISUALS,
  activityCategory,
  activityKeys,
  formatElapsed,
  touchedPaths,
} from './helpers';
import type { ProgressViewProps } from './types';

const RECENT = 6;

/** Placeholder boxes + connectors hinting at the diagram being drawn. */
function SkeletonDiagram() {
  const boxes = [
    { x: 6, y: 52, w: 88 },
    { x: 132, y: 10, w: 96 },
    { x: 132, y: 94, w: 96 },
    { x: 266, y: 52, w: 88 },
  ];
  const links = [
    'M94 70 C113 70 113 28 132 28',
    'M94 70 C113 70 113 112 132 112',
    'M228 28 C247 28 247 70 266 70',
    'M228 112 C247 112 247 70 266 70',
  ];
  return (
    <svg
      viewBox="0 0 360 140"
      width={360}
      height={140}
      aria-hidden
      className="h-auto w-full max-w-[360px]"
    >
      {links.map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          strokeLinecap="round"
          className="stroke-border-strong"
        />
      ))}
      {boxes.map((b, i) => (
        <g
          key={i}
          className="animate-pulse-soft motion-reduce:animate-none"
          style={{ animationDelay: `${i * 220}ms` }}
        >
          <rect
            x={b.x}
            y={b.y}
            width={b.w}
            height={36}
            rx={9}
            strokeWidth={1.5}
            className={cn('fill-surface', i === 1 ? 'stroke-accent/60' : 'stroke-border')}
          />
          <rect
            x={b.x + 11}
            y={b.y + 12}
            width={12}
            height={12}
            rx={3.5}
            className={i === 1 ? 'fill-accent-soft' : 'fill-surface-3'}
          />
          <rect
            x={b.x + 29}
            y={b.y + 12.5}
            width={b.w - 44}
            height={5}
            rx={2.5}
            className="fill-surface-3"
          />
          <rect
            x={b.x + 29}
            y={b.y + 21}
            width={(b.w - 44) * 0.55}
            height={4}
            rx={2}
            className="fill-surface-2"
          />
        </g>
      ))}
    </svg>
  );
}

/** Live view while a diagram is queued / running. Fills its parent and centers its content. */
export function ProgressView({
  graph,
  activity,
  providerName,
  queuePosition,
  onCancel,
  className,
}: ProgressViewProps) {
  const queued = graph.status === 'queued';
  const now = useNow(1000, graph.status === 'queued' || graph.status === 'running');
  const since = Date.parse((queued ? graph.createdAt : graph.startedAt) ?? graph.createdAt);
  const elapsed = Number.isFinite(since) ? now - since : 0;

  const recent = useMemo(() => {
    const keys = activityKeys(activity);
    return activity
      .map((item, i) => ({ item, key: keys[i] ?? String(i) }))
      .filter(({ item }) => item.text.trim())
      .slice(-RECENT);
  }, [activity]);
  const touched = useMemo(() => touchedPaths(activity).length, [activity]);

  const last = recent[recent.length - 1]?.item;
  const status = queued
    ? `Queued${queuePosition ? ` · #${queuePosition}` : ''}`
    : !last && !graph.startedAt
      ? 'Starting…'
      : last?.kind === 'thinking'
        ? 'Thinking…'
        : 'Exploring the code…';

  return (
    <div
      className={cn(
        'flex h-full min-h-0 flex-col items-center justify-center gap-6 overflow-y-auto p-8',
        className,
      )}
    >
      <SkeletonDiagram />

      <div className="flex flex-col items-center gap-1 text-center">
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-sm font-medium text-fg"
        >
          {queued ? (
            <Clock size={15} className="text-subtle" aria-hidden />
          ) : (
            <Spinner size={15} className="motion-reduce:animate-none" />
          )}
          <span>{status}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted">
          <span className="font-mono tabular-nums" aria-label="Elapsed time">
            {formatElapsed(elapsed)}
          </span>
          <span aria-hidden className="text-subtle">
            ·
          </span>
          <span className="max-w-[16rem] truncate">
            {providerName}
            {graph.model ? ` · ${graph.model}` : ''}
          </span>
        </div>
      </div>

      {recent.length ? (
        <ol
          aria-label="Recent activity"
          className="flex w-full max-w-md flex-col gap-0.5 rounded-xl border border-border bg-surface px-3 py-2 shadow-card"
        >
          {recent.map(({ item, key }, i) => {
            const visual = ACTIVITY_VISUALS[activityCategory(item.kind, item.text)];
            const Icon = visual.icon;
            const age = recent.length - 1 - i;
            return (
              <li
                key={key}
                className={cn(
                  'flex h-6 min-w-0 animate-fade-in items-center gap-2 text-[12.5px] motion-reduce:animate-none',
                  age === 0 ? 'text-fg' : 'text-muted',
                  age >= 3 && 'opacity-60',
                )}
              >
                <Icon
                  size={13}
                  aria-label={visual.label}
                  className={cn('shrink-0', visual.className)}
                />
                <span className="truncate">{item.text.split('\n')[0]}</span>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="flex items-center gap-3">
        {touched > 0 ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Files size={13} aria-hidden className="text-subtle" />
            {touched} {touched === 1 ? 'file' : 'files'} touched
          </span>
        ) : null}
        <Button icon={CircleStop} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
