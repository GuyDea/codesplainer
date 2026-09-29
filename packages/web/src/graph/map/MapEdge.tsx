/**
 * Conversation map edge: starts on the expanded box inside the parent's thumbnail (a port dot)
 * and curves into the child card. Style per relation.
 */
import { memo } from 'react';
import { EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { cn } from '../../lib/cn';
import type { MapFlowEdge, MapRelation } from './types';

const STYLES: Record<MapRelation, { stroke: string; width: number; dash?: string }> = {
  expand: { stroke: 'var(--accent)', width: 1.8 },
  ask: { stroke: 'color-mix(in oklab, var(--accent) 80%, var(--muted))', width: 1.6, dash: '5 4' },
  'follow-up': { stroke: 'color-mix(in oklab, var(--muted) 72%, var(--canvas))', width: 1.5 },
  code: {
    stroke: 'color-mix(in oklab, var(--muted) 82%, var(--canvas))',
    width: 1.6,
    dash: '1.5 4',
  },
};

function cubic(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Parameter t at which the (x-monotonic) curve reaches x. */
function tAtX(x: number, x0: number, x1: number, x2: number, x3: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (cubic(x0, x1, x2, x3, mid) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

function MapEdgeComponent({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
}: EdgeProps<MapFlowEdge>) {
  if (!data) return null;
  const style = STYLES[data.relation];
  // Leave room for the arrowhead in front of the target card.
  const tipX = targetX - 1;
  const endX = tipX - 6;
  const dx = Math.max(56, (endX - sourceX) * 0.42);
  const c1x = sourceX + dx;
  const c2x = endX - dx;
  const path = `M ${sourceX} ${sourceY} C ${c1x} ${sourceY}, ${c2x} ${targetY}, ${endX} ${targetY}`;
  // Label: halfway between the parent card's border and the child, on the curve.
  const midX = (Math.max(sourceX, data.exitX) + tipX) / 2;
  const t = endX > sourceX ? tAtX(midX, sourceX, c1x, c2x, endX) : 0.5;
  const lx = cubic(sourceX, c1x, c2x, endX, t);
  const ly = cubic(sourceY, sourceY, targetY, targetY, t);
  const arrow = `M ${tipX} ${targetY} L ${tipX - 8.5} ${targetY - 4.3} L ${tipX - 6.2} ${targetY} L ${tipX - 8.5} ${targetY + 4.3} Z`;

  return (
    <>
      <g className={cn('cs-map-edge-group', data.dim && 'is-dim')} data-edge-id={id}>
        <path d={path} className="cs-map-edge-halo" strokeWidth={style.width + 4} />
        <path
          d={path}
          className="cs-map-edge"
          style={{ stroke: style.stroke }}
          strokeWidth={style.width}
          strokeDasharray={style.dash}
        />
        <path d={arrow} style={{ fill: style.stroke }} />
        {data.fromPort ? (
          <circle
            cx={sourceX}
            cy={sourceY}
            r={3.4}
            style={{ fill: style.stroke, stroke: 'var(--surface)' }}
            strokeWidth={1.6}
          />
        ) : null}
      </g>
      <EdgeLabelRenderer>
        <div
          className={cn('cs-map-label', data.dim && 'is-dim')}
          style={{ left: lx, top: ly }}
          title={data.subject ? `${data.relation}: ${data.subject}` : data.relation}
        >
          <span className="shrink-0 font-semibold" style={{ color: style.stroke }}>
            {data.relation}
          </span>
          {data.subject ? <span className="min-w-0 truncate">{data.subject}</span> : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const MapEdge = memo(MapEdgeComponent);
