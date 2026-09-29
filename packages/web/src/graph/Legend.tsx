/** Compact floating card: the box kinds and line styles used by a diagram. */
import './graph.css';
import { useMemo } from 'react';
import {
  EDGE_KIND_INFO,
  EDGE_KINDS,
  NODE_KIND_INFO,
  NODE_KINDS,
  type EdgeKind,
  type NodeKind,
} from '@codesplainer/shared';
import { cn } from '../lib/cn';
import type { LegendProps } from './types';
import { EDGE_VISUALS, kindStyle, NODE_VISUALS } from './visuals';

function LineSample({ kind }: { kind: EdgeKind }) {
  const v = EDGE_VISUALS[kind];
  return (
    <svg
      width={30}
      height={10}
      viewBox="0 0 30 10"
      className="shrink-0 overflow-visible"
      aria-hidden
    >
      <path
        d={v.marker === 'arrow' ? 'M 1 5 L 23 5' : 'M 1 5 L 29 5'}
        className={cn('cs-edge-path', v.animated && 'cs-edge-animated')}
        style={{ stroke: 'var(--muted)' }}
        strokeWidth={v.width}
        strokeDasharray={v.dash}
      />
      {v.marker === 'arrow' ? (
        <path d="M 29 5 L 22.5 1.6 L 24 5 L 22.5 8.4 Z" style={{ fill: 'var(--muted)' }} />
      ) : null}
    </svg>
  );
}

export function Legend({ spec, className }: LegendProps) {
  const { kinds, edgeKinds } = useMemo(() => {
    const nodeSet = new Set<NodeKind>(spec.nodes.map((n) => n.kind));
    const edgeSet = new Set<EdgeKind>(spec.edges.map((e) => e.kind));
    return {
      kinds: NODE_KINDS.filter((k) => nodeSet.has(k)),
      edgeKinds: spec.kind === 'sequence' ? [] : EDGE_KINDS.filter((k) => edgeSet.has(k)),
    };
  }, [spec]);

  return (
    <div
      className={cn(
        'w-max max-w-[280px] rounded-xl border border-border bg-surface/95 px-3 py-2.5 text-[11.5px] shadow-card backdrop-blur-sm',
        className,
      )}
      role="note"
      aria-label="Legend"
    >
      <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-subtle uppercase">
        Boxes
      </div>
      <ul className={cn('grid gap-x-3 gap-y-1', kinds.length > 5 ? 'grid-cols-2' : 'grid-cols-1')}>
        {kinds.map((kind) => {
          const Icon = NODE_VISUALS[kind].icon;
          return (
            <li
              key={kind}
              className="flex min-w-0 items-center gap-1.5 text-muted"
              title={NODE_KIND_INFO[kind].hint}
            >
              <span
                className="cs-kind-icon kind-fg flex size-[18px] shrink-0 items-center justify-center rounded-[5px]"
                style={kindStyle(kind)}
              >
                <Icon size={11} strokeWidth={2.2} />
              </span>
              <span className="truncate">{NODE_KIND_INFO[kind].label}</span>
            </li>
          );
        })}
      </ul>
      {edgeKinds.length ? (
        <>
          <div className="mt-2.5 mb-1.5 text-[10px] font-semibold tracking-wider text-subtle uppercase">
            Lines
          </div>
          <ul
            className={cn(
              'grid gap-x-3 gap-y-1',
              edgeKinds.length > 4 ? 'grid-cols-2' : 'grid-cols-1',
            )}
          >
            {edgeKinds.map((kind) => (
              <li
                key={kind}
                className="flex min-w-0 items-center gap-2 text-muted"
                title={EDGE_KIND_INFO[kind].hint}
              >
                <LineSample kind={kind} />
                <span className="truncate">{EDGE_KIND_INFO[kind].label}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
