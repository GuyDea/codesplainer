import { MessagesSquare, Waypoints, X } from 'lucide-react';
import { EDGE_KIND_INFO, NODE_KIND_INFO, type GraphNode } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { EDGE_VISUALS, NODE_VISUALS, kindStyle } from '../graph/visuals';
import { Button, IconButton, Tooltip } from '../ui';
import type { EdgeInspectorProps } from './types';

function NodeChip({
  node,
  fallback,
  onClick,
}: {
  node: GraphNode | undefined;
  fallback: string;
  onClick: () => void;
}) {
  const Icon = node ? NODE_VISUALS[node.kind].icon : null;
  return (
    <button
      type="button"
      onClick={onClick}
      style={node ? kindStyle(node.kind) : undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-shadow',
        'hover:shadow-card focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none',
        node ? 'kind-tint' : 'border-border bg-surface-2',
      )}
    >
      {Icon ? (
        <span className="kind-fg flex shrink-0">
          <Icon size={15} aria-hidden />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{node?.label ?? fallback}</span>
        {node ? (
          <span className="truncate text-[11px] text-muted">{NODE_KIND_INFO[node.kind].label}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Side panel for the selected arrow. Same sizing as NodeInspector. */
export function EdgeInspector({
  graph,
  edge,
  onExplain,
  onSelectNode,
  onClose,
  className,
}: EdgeInspectorProps) {
  const nodes = graph.spec?.nodes ?? [];
  const from = nodes.find((n) => n.id === edge.from);
  const to = nodes.find((n) => n.id === edge.to);
  const kind = EDGE_KIND_INFO[edge.kind];
  const visual = EDGE_VISUALS[edge.kind];
  const title = edge.label ?? kind.label;

  return (
    <aside
      aria-label={`Connection: ${from?.label ?? edge.from} to ${to?.label ?? edge.to}`}
      className={cn('flex min-h-0 flex-col overflow-y-auto', className)}
    >
      <div className="flex items-start gap-2.5 p-3 pb-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-muted">
          <Waypoints size={16} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-px">
          <h2 className="text-sm leading-snug font-semibold break-words text-fg">{title}</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Tooltip label={kind.hint} delay={500}>
              <span>{edge.label ? kind.label : kind.hint}</span>
            </Tooltip>
            {edge.step !== undefined ? (
              <>
                <span aria-hidden className="text-subtle">
                  ·
                </span>
                <span className="tabular-nums">Step {edge.step}</span>
              </>
            ) : null}
          </div>
        </div>
        <IconButton icon={X} label="Close" onClick={onClose} className="-mt-0.5 -mr-1" />
      </div>

      <div className="flex flex-col px-3 py-2">
        <NodeChip node={from} fallback={edge.from} onClick={() => onSelectNode(edge.from)} />
        <div className="flex items-center gap-2 pl-4">
          <svg
            width="16"
            height="34"
            viewBox="0 0 16 34"
            aria-hidden
            className="shrink-0 text-subtle"
          >
            <line
              x1="8"
              y1="2"
              x2="8"
              y2={visual.marker === 'arrow' ? 27 : 32}
              stroke="currentColor"
              strokeWidth={visual.width}
              strokeDasharray={visual.dash}
              strokeLinecap="round"
            />
            {visual.marker === 'arrow' ? (
              <path d="M3.5 25.5 L8 32 L12.5 25.5 Z" fill="currentColor" />
            ) : null}
          </svg>
          {edge.label ? (
            <span className="min-w-0 truncate text-xs text-muted italic">{edge.label}</span>
          ) : null}
        </div>
        <NodeChip node={to} fallback={edge.to} onClick={() => onSelectNode(edge.to)} />
      </div>

      <div className="p-3">
        <Button
          variant="primary"
          size="md"
          icon={MessagesSquare}
          onClick={onExplain}
          className="w-full"
        >
          Explain this interaction
        </Button>
      </div>
    </aside>
  );
}
