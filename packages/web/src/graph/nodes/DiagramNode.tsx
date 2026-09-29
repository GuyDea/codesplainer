/** A diagram box: kind-tinted card with icon, label, detail, ref chip, children badge, toolbar. */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Handle, NodeToolbar, Position, type NodeProps } from '@xyflow/react';
import { CodeXml, FileCode, Folder, Maximize2, MessageSquare } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Button, IconButton, Spinner, StatusIcon, Tooltip } from '../../ui';
import { preferredChild } from '../canvas/children';
import { useCanvas } from '../canvas/context';
import type { DiagramFlowNode } from '../canvas/types';
import { NODE_METRICS } from '../layout';
import { refChipText, refTitle } from '../refs';
import type { NodeChildInfo } from '../types';
import { kindStyle, NODE_VISUALS, ORIGIN_VISUALS } from '../visuals';

const M = NODE_METRICS;

function clampStyle(lines: number): CSSProperties {
  return {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
  };
}

function DiagramNodeComponent({ id, data, selected }: NodeProps<DiagramFlowNode>) {
  const ctx = useCanvas();
  const { node, children } = data;
  const Icon = NODE_VISUALS[node.kind].icon;
  const tb = ctx.direction === 'TB';
  const firstRef = node.refs[0];
  const canExpand = ctx.canExpand && node.expandable !== false;
  const canOpen = ctx.canOpenRef && Boolean(firstRef);
  const hasActions = canExpand || ctx.canAsk || canOpen;
  const toolbarVisible = hasActions && ctx.toolbarNodeId === id;

  return (
    <>
      <Handle type="target" position={tb ? Position.Top : Position.Left} isConnectable={false} />
      <Handle
        type="source"
        position={tb ? Position.Bottom : Position.Right}
        isConnectable={false}
      />
      <div
        key={data.layoutKey}
        className={cn(
          'cs-node kind-tint cs-enter',
          node.highlight && 'is-highlight',
          selected && 'is-selected',
          canExpand && 'cursor-pointer',
        )}
        style={{ ...kindStyle(node.kind), '--cs-delay': `${data.delay}ms` } as CSSProperties}
        data-node-id={id}
      >
        <div
          className="flex h-full items-center"
          style={{ paddingLeft: M.padX, paddingRight: M.padX }}
        >
          <div className="flex w-full min-w-0 items-start" style={{ gap: M.iconGap }}>
            <span
              className="cs-kind-icon kind-fg flex shrink-0 items-center justify-center rounded-[7px]"
              style={{ width: M.iconSize, height: M.iconSize }}
              aria-hidden
            >
              <Icon size={15} strokeWidth={2.1} />
            </span>
            <div
              className="flex min-w-0 flex-1 flex-col justify-center"
              style={{ minHeight: M.iconSize }}
            >
              <div
                className="cs-node-label font-semibold text-fg"
                style={{
                  fontSize: M.label.size,
                  lineHeight: `${M.labelLine}px`,
                  ...clampStyle(data.labelLines),
                }}
                title={node.label}
              >
                {node.label}
              </div>
              {node.detail ? (
                <div
                  className="cs-node-detail text-muted"
                  style={{
                    marginTop: M.detailGap,
                    fontSize: M.detail.size,
                    lineHeight: `${M.detailLine}px`,
                    ...clampStyle(Math.max(1, data.detailLines)),
                  }}
                  title={node.detail}
                >
                  {node.detail}
                </div>
              ) : null}
              {firstRef ? (
                <button
                  type="button"
                  className="cs-chip nopan inline-flex max-w-full items-center self-start rounded-[5px] font-mono text-muted transition-colors disabled:pointer-events-none"
                  style={{
                    marginTop: M.chipGap,
                    height: M.chipHeight,
                    paddingLeft: M.chipPadX,
                    paddingRight: M.chipPadX,
                    gap: M.chipIconGap,
                    fontSize: M.chip.size,
                  }}
                  title={node.refs.map(refTitle).join('\n')}
                  aria-label={`Open ${refTitle(firstRef)}`}
                  disabled={!ctx.canOpenRef}
                  onClick={(event) => {
                    event.stopPropagation();
                    ctx.openRef(firstRef);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  {firstRef.isDir || !firstRef.path ? (
                    <Folder size={M.chipIcon} className="shrink-0 opacity-70" />
                  ) : (
                    <FileCode size={M.chipIcon} className="shrink-0 opacity-70" />
                  )}
                  <span className="truncate">{refChipText(firstRef, ctx.multiFolder)}</span>
                  {node.refs.length > 1 ? (
                    <span className="shrink-0 text-subtle">+{node.refs.length - 1}</span>
                  ) : null}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        {children.length > 0 ? <ChildrenBadge nodeId={id} items={children} /> : null}
      </div>
      <NodeToolbar isVisible={toolbarVisible} position={Position.Top} offset={10}>
        <div
          className="nopan flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-pop animate-pop-in"
          onMouseEnter={ctx.holdHover}
          onMouseLeave={() => ctx.hover(null)}
          role="toolbar"
          aria-label={`Actions for ${node.label}`}
        >
          {canExpand ? (
            <Tooltip label="Explain & expand" shortcut="E" side="top">
              <Button
                size="xs"
                variant="ghost"
                icon={Maximize2}
                className="text-fg hover:text-accent"
                onClick={() => ctx.expand(id)}
              >
                Expand
              </Button>
            </Tooltip>
          ) : null}
          {ctx.canAsk ? (
            <IconButton
              icon={MessageSquare}
              label="Ask about this"
              shortcut="A"
              size="xs"
              tooltipSide="top"
              onClick={() => ctx.ask(id)}
            />
          ) : null}
          {canOpen && firstRef ? (
            <IconButton
              icon={CodeXml}
              label="Open code"
              size="xs"
              tooltipSide="top"
              onClick={() => ctx.openRef(firstRef)}
            />
          ) : null}
        </div>
      </NodeToolbar>
    </>
  );
}

function ChildrenBadge({ nodeId, items }: { nodeId: string; items: NodeChildInfo[] }) {
  const ctx = useCanvas();
  const [listOpen, setListOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const pending = items.some((c) => c.status === 'running' || c.status === 'queued');
  const latest = items[items.length - 1];
  const target = preferredChild(items);
  if (!latest || !target) return null;
  const many = items.length > 1;

  const open = () => {
    window.clearTimeout(timer.current);
    if (many) timer.current = window.setTimeout(() => setListOpen(true), 180);
  };
  const close = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setListOpen(false), 160);
  };
  const keep = () => window.clearTimeout(timer.current);

  const label = many
    ? `${items.length} diagrams from this box — open “${target.title}”`
    : `Open “${target.title}”`;

  return (
    <>
      <button
        type="button"
        className={cn(
          'nopan absolute -top-2.5 -right-2.5 z-10 flex h-5 items-center gap-1 rounded-full border bg-surface pr-1.5 pl-1 text-[10.5px] leading-none font-semibold shadow-card transition-colors',
          'border-border text-muted hover:border-accent/60 hover:text-accent',
        )}
        aria-label={label}
        title={many ? undefined : label}
        disabled={!ctx.canOpenChild}
        onClick={(event) => {
          event.stopPropagation();
          ctx.openChild(target.graphId);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        data-node-children={nodeId}
      >
        {pending ? <Spinner size={11} /> : <StatusIcon status={latest.status} size={11} />}
        <span className="tabular-nums">{items.length}</span>
      </button>
      {many ? (
        <NodeToolbar isVisible={listOpen} position={Position.Right} align="start" offset={14}>
          <div
            className="nopan w-64 rounded-lg border border-border bg-surface p-1 shadow-pop animate-pop-in"
            onMouseEnter={keep}
            onMouseLeave={close}
            role="menu"
            aria-label="Diagrams created from this box"
          >
            <div className="px-2 pt-1 pb-1.5 text-[10.5px] font-semibold tracking-wide text-subtle uppercase">
              From this box
            </div>
            {[...items].reverse().map((child) => {
              const OriginIcon = ORIGIN_VISUALS[child.type].icon;
              return (
                <button
                  key={child.graphId}
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] text-fg transition-colors hover:bg-surface-2 disabled:opacity-50"
                  disabled={!ctx.canOpenChild}
                  onClick={(event) => {
                    event.stopPropagation();
                    setListOpen(false);
                    ctx.openChild(child.graphId);
                  }}
                >
                  <OriginIcon size={13} className="shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  <StatusIcon status={child.status} size={12} />
                </button>
              );
            })}
          </div>
        </NodeToolbar>
      ) : null}
    </>
  );
}

export const DiagramNode = memo(DiagramNodeComponent);
