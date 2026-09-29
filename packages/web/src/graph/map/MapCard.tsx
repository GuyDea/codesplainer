/** A conversation map card: one diagram with origin, status, title, thumbnail and footer. */
import { memo, useContext, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Handle,
  NodeToolbar,
  Position,
  useUpdateNodeInternals,
  type NodeProps,
} from '@xyflow/react';
import { CircleStop, CircleX } from 'lucide-react';
import { isPending } from '@codesplainer/shared';
import { cn } from '../../lib/cn';
import { Spinner, StatusIcon } from '../../ui';
import { GraphThumbnail } from '../GraphThumbnail';
import { GRAPH_KIND_ICONS, ORIGIN_VISUALS, STATUS_VISUALS } from '../visuals';
import { MapContext } from './context';
import { MAP_CARD } from './metrics';
import type { MapFlowNode } from './types';

function MapCardComponent({ id, data }: NodeProps<MapFlowNode>) {
  const { open } = useContext(MapContext);
  const updateNodeInternals = useUpdateNodeInternals();
  const portsKey = data.ports.map((p) => `${p.id}@${p.x},${p.y}`).join('|');
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portsKey, updateNodeInternals]);

  const [tip, setTip] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showTip = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTip(true), 450);
  };
  const hideTip = () => {
    window.clearTimeout(timer.current);
    setTip(false);
  };

  const { entry } = data;
  const origin = ORIGIN_VISUALS[entry.origin.type];
  const OriginIcon = origin.icon;
  const spec = entry.status === 'done' ? entry.spec : undefined;
  const KindIcon = spec ? GRAPH_KIND_ICONS[spec.kind] : undefined;
  const pending = isPending(entry.status);
  const status = STATUS_VISUALS[entry.status];

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open(id);
    }
  };

  return (
    <>
      <Handle id="in" type="target" position={Position.Left} isConnectable={false} />
      <Handle id="out" type="source" position={Position.Right} isConnectable={false} />
      {data.ports.map((p) => (
        <Handle
          key={p.id}
          id={p.id}
          type="source"
          position={Position.Right}
          isConnectable={false}
          style={{ left: p.x, top: p.y, right: 'auto', transform: 'translate(-50%, -50%)' }}
        />
      ))}
      <div
        role="button"
        tabIndex={0}
        aria-current={data.isCurrent ? 'true' : undefined}
        aria-label={`${data.title}. ${origin.label}, ${status.label}.`}
        className={cn(
          'cs-card flex cursor-pointer flex-col outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
          data.isCurrent && 'is-current',
          entry.status === 'error' && 'is-error',
          data.dim && 'is-dim',
        )}
        style={{ padding: MAP_CARD.pad }}
        onKeyDown={onKeyDown}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        onPointerDown={hideTip}
      >
        <div className="flex items-start gap-2" style={{ height: MAP_CARD.header }}>
          <span
            className={cn(
              'mt-px flex size-[18px] shrink-0 items-center justify-center rounded-[5px]',
              data.isCurrent ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-muted',
            )}
            aria-hidden
          >
            <OriginIcon size={11} strokeWidth={2.2} />
          </span>
          <div className="line-clamp-2 min-w-0 flex-1 text-[12.5px] leading-4 font-semibold text-fg">
            {data.title}
          </div>
          <StatusIcon status={entry.status} size={14} className="mt-0.5" />
        </div>
        <div
          className="cs-card-thumb relative overflow-hidden"
          style={{
            marginTop: MAP_CARD.gap,
            width: MAP_CARD.thumbWidth,
            height: MAP_CARD.thumbHeight,
          }}
        >
          {spec ? (
            <GraphThumbnail
              spec={spec}
              width={MAP_CARD.thumbWidth}
              height={MAP_CARD.thumbHeight}
              markedNodeIds={data.marked}
            />
          ) : pending ? (
            <div className="cs-skeleton flex h-full w-full flex-col items-center justify-center gap-1.5">
              <Spinner
                size={16}
                className={entry.status === 'queued' ? 'text-subtle' : undefined}
              />
              <span className="text-[11px] font-medium text-muted">{status.label}…</span>
            </div>
          ) : entry.status === 'error' ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-danger-soft px-4 text-center">
              <CircleX size={16} className="text-danger" />
              <span className="line-clamp-2 text-[11px] leading-[14px] text-danger">
                {entry.error || 'Generation failed'}
              </span>
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-subtle">
              <CircleStop size={16} />
              <span className="text-[11px] font-medium">{status.label}</span>
            </div>
          )}
        </div>
        <div
          className="flex items-center gap-1.5 text-[11px] leading-none text-muted"
          style={{ marginTop: MAP_CARD.gap, height: MAP_CARD.footer }}
        >
          {spec && KindIcon ? (
            <>
              <KindIcon size={12} className="shrink-0 text-subtle" />
              <span className="shrink-0 tabular-nums">
                {spec.nodes.length} {spec.nodes.length === 1 ? 'box' : 'boxes'}
              </span>
              <span className="text-border-strong">·</span>
            </>
          ) : null}
          <span className="min-w-0 truncate text-subtle">{data.relation}</span>
        </div>
      </div>
      <NodeToolbar isVisible={tip} position={Position.Bottom} offset={8}>
        <div className="pointer-events-none max-w-[300px] rounded-lg border border-border bg-surface px-3 py-2 shadow-pop animate-fade-in">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
            <OriginIcon size={11} />
            {origin.label}
          </div>
          <div className="text-[12.5px] leading-[17px] text-fg">{entry.question}</div>
          {spec?.summary ? (
            <div className="mt-1 line-clamp-3 text-[11.5px] leading-[15px] text-muted">
              {spec.summary}
            </div>
          ) : null}
        </div>
      </NodeToolbar>
    </>
  );
}

export const MapCard = memo(MapCardComponent);
