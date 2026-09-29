/** Miniature SVG of a diagram: kind-tinted boxes with an icon dot and a text bar, simple edges. */
import './graph.css';
import { memo, useEffect, useReducer } from 'react';
import { cn } from '../lib/cn';
import { layoutGraph, NODE_METRICS, peekGraphLayout } from './layout';
import { thumbnailModel } from './thumbnail';
import type { GraphThumbnailProps } from './types';
import { EDGE_VISUALS, kindStyle } from './visuals';

const f = (n: number) => Math.round(n * 10) / 10;

function GraphThumbnailComponent({
  spec,
  width = 160,
  height = 96,
  highlightNodeId,
  markedNodeIds,
  className,
}: GraphThumbnailProps) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const needsLayout = spec.kind !== 'sequence' && !peekGraphLayout(spec);
  useEffect(() => {
    if (!needsLayout) return;
    let cancelled = false;
    // Upgrade from the quick fallback to the real layout once ELK is done.
    void layoutGraph(spec).then(() => {
      if (!cancelled) refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [spec, needsLayout]);

  const model = thumbnailModel(spec, width, height);
  const marked = new Set(markedNodeIds ?? []);
  const s = model.scale;
  const iconSize = NODE_METRICS.iconSize * s;
  const showIcon = iconSize >= 3;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('block shrink-0', className)}
      role="img"
      aria-label={`Thumbnail: ${spec.title}`}
    >
      {model.groups.map((g, i) => (
        <rect
          key={`g${i}`}
          className="cs-thumb-group"
          x={g.x}
          y={g.y}
          width={g.width}
          height={g.height}
          rx={Math.min(4, 14 * s)}
          strokeWidth={0.75}
        />
      ))}
      {model.lifelines.map((l, i) => (
        <line
          key={`l${i}`}
          className="cs-thumb-lifeline"
          x1={l.x}
          x2={l.x}
          y1={l.top}
          y2={l.bottom}
          strokeWidth={0.75}
        />
      ))}
      {model.edges.map((e) => (
        <polyline
          key={e.id}
          className="cs-thumb-edge"
          points={e.points.map((p) => `${p.x},${p.y}`).join(' ')}
          strokeWidth={0.9}
          strokeDasharray={EDGE_VISUALS[e.kind].dash ? '2 1.5' : undefined}
        />
      ))}
      {model.boxes.map((b) => {
        const focus = b.id === highlightNodeId;
        const isMarked = marked.has(b.id);
        const barHeight = Math.max(1.4, Math.min(3, b.height * 0.16));
        const textX =
          b.x +
          (NODE_METRICS.padX + (showIcon ? NODE_METRICS.iconSize + NODE_METRICS.iconGap : 0)) * s;
        const barWidth = Math.max(
          1.5,
          Math.min(b.barWidth, b.x + b.width - textX - NODE_METRICS.padX * s),
        );
        return (
          <g key={b.id} style={kindStyle(b.kind)}>
            <rect
              className={cn(
                'cs-thumb-box',
                b.highlight && 'is-highlight',
                isMarked && 'is-marked',
                focus && 'is-focus',
              )}
              x={b.x}
              y={b.y}
              width={b.width}
              height={b.height}
              rx={f(Math.min(3.5, b.height / 3.5))}
              strokeWidth={focus ? 1.6 : isMarked || b.highlight ? 1.2 : 0.8}
            />
            {showIcon ? (
              <rect
                className="cs-thumb-bar"
                x={f(b.x + NODE_METRICS.padX * s)}
                y={f(b.y + b.height / 2 - iconSize / 2)}
                width={f(iconSize)}
                height={f(iconSize)}
                rx={f(iconSize / 4)}
              />
            ) : null}
            <rect
              className="cs-thumb-bar"
              x={f(showIcon ? textX : b.x + b.width * 0.18)}
              y={f(b.y + b.height / 2 - barHeight / 2)}
              width={f(showIcon ? barWidth : b.width * 0.64)}
              height={f(barHeight)}
              rx={f(barHeight / 2)}
            />
          </g>
        );
      })}
    </svg>
  );
}

export const GraphThumbnail = memo(GraphThumbnailComponent);
