/** Diagram edge: rounded path through the layout route, arrowhead, label pill, step badge. */
import { memo, type CSSProperties } from 'react';
import { EdgeLabelRenderer, Position, type EdgeProps } from '@xyflow/react';
import { cn } from '../../lib/cn';
import { useCanvas } from '../canvas/context';
import type { DiagramFlowEdge } from '../canvas/types';
import { measureEdgeLabel, type Point } from '../layout';
import { refTitle } from '../refs';
import { EDGE_VISUALS } from '../visuals';
import { arrowHead, polylineMidpoint, roundedPath, trimEnd } from './path';

/** Orthogonal step route between two handles (used when no layout route is known). */
function stepRoute(
  sx: number,
  sy: number,
  sp: Position,
  tx: number,
  ty: number,
  tp: Position,
): Point[] {
  const horizontal = sp === Position.Left || sp === Position.Right;
  if (horizontal && (tp === Position.Left || tp === Position.Right)) {
    const mx = (sx + tx) / 2;
    return [
      { x: sx, y: sy },
      { x: mx, y: sy },
      { x: mx, y: ty },
      { x: tx, y: ty },
    ];
  }
  const my = (sy + ty) / 2;
  return [
    { x: sx, y: sy },
    { x: sx, y: my },
    { x: tx, y: my },
    { x: tx, y: ty },
  ];
}

function DiagramEdgeComponent({
  id,
  data,
  selected,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<DiagramFlowEdge>) {
  const ctx = useCanvas();
  if (!data) return null;
  const { edge } = data;
  const visual = EDGE_VISUALS[edge.kind];
  const points =
    data.points && data.points.length >= 2
      ? data.points
      : stepRoute(sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition);
  const hasArrow = visual.marker === 'arrow';
  const path = roundedPath(hasArrow ? trimEnd(points, 6) : points, 10);
  const arrow = hasArrow ? arrowHead(points, 8.5, 4.3) : '';
  const current = data.current;
  const strokeWidth = visual.width + (current ? 1 : selected ? 0.7 : data.active ? 0.35 : 0);
  const delay = { '--cs-delay': `${data.delay}ms` } as CSSProperties;

  let labelBox = data.label;
  if (!labelBox) {
    const size = measureEdgeLabel(edge);
    if (size) {
      const mid = polylineMidpoint(points);
      labelBox = { x: mid.x - size.width / 2, y: mid.y - size.height / 2, ...size };
    }
  }
  const hasStep = edge.step !== undefined;
  const text = edge.label;
  const caption = text ? (hasStep ? `${edge.step}. ${text}` : text) : `Step ${edge.step}`;
  // Where the arrow happens in the code (first ref, "+N" for more).
  const refs = edge.refs ?? [];
  const where = refs[0]
    ? `${refTitle(refs[0])}${refs.length > 1 ? ` +${refs.length - 1}` : ''}`
    : undefined;

  return (
    <>
      <g
        key={data.layoutKey}
        className={cn(
          'cs-edge-group cs-edge-fade',
          data.active && 'is-active',
          current && 'is-step',
          selected && 'is-selected',
          data.dim && !selected && 'is-dim',
        )}
        style={delay}
      >
        {where ? <title>{text ? `${text}\n${where}` : where}</title> : null}
        <path d={path} className="cs-edge-hit react-flow__edge-interaction" strokeWidth={16} />
        <path
          d={path}
          className={cn('cs-edge-path', visual.animated && 'cs-edge-animated')}
          strokeWidth={strokeWidth}
          strokeDasharray={visual.dash}
        />
        {current ? (
          // Dots running from source to target: the direction of the step.
          <path d={path} className="cs-edge-flow" strokeWidth={Math.max(1, strokeWidth - 1.2)} />
        ) : null}
        {arrow ? <path d={arrow} className="cs-edge-arrow" /> : null}
      </g>
      {labelBox ? (
        <EdgeLabelRenderer>
          <div
            key={data.layoutKey}
            className={cn(
              'cs-edge-label cs-edge-fade nopan',
              hasStep && 'has-step',
              !text && 'step-only',
              current && 'is-step',
              selected && 'is-selected',
              data.active && 'is-active',
              data.dim && !selected && 'is-dim',
            )}
            style={{
              ...delay,
              transform: `translate(${labelBox.x}px, ${labelBox.y}px)`,
              width: labelBox.width,
              height: labelBox.height,
            }}
            title={where ? `${caption}\n${where}` : caption}
            onClick={(event) => {
              event.stopPropagation();
              ctx.selectEdge(id);
            }}
            data-edge-id={id}
          >
            {hasStep ? <span className="cs-step">{edge.step}</span> : null}
            {text ? <span className="min-w-0 truncate">{text}</span> : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

export const DiagramEdge = memo(DiagramEdgeComponent);
