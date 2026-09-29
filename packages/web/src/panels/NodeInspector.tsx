import { ArrowLeft, ArrowRight, Folder, RotateCcw, SquareArrowOutUpRight, X } from 'lucide-react';
import {
  EDGE_KIND_INFO,
  NODE_KIND_INFO,
  childrenOfNode,
  expansionOfNode,
  formatRef,
  graphDisplayTitle,
  isPending,
  neighbours,
  type CodeRef,
  type GraphEdge,
  type GraphNode,
} from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { NODE_VISUALS, ORIGIN_VISUALS, kindStyle } from '../graph/visuals';
import { Badge, Button, IconButton, Kbd, StatusIcon, Tooltip } from '../ui';
import { dirName, fileIcon, fileName, lineRangeLabel } from './helpers';
import { Section } from './parts';
import type { NodeInspectorProps } from './types';

const EXPAND_ICON = ORIGIN_VISUALS.expand.icon;
const ASK_ICON = ORIGIN_VISUALS['ask-node'].icon;

/** Kbd hint that stays readable on a primary (accent) button. */
function ButtonKbd({ children, primary }: { children: string; primary?: boolean }) {
  return (
    <Kbd className={cn('ml-auto', primary && 'border-transparent bg-accent-fg/20 text-accent-fg')}>
      {children}
    </Kbd>
  );
}

/**
 * Side panel for the selected box. Scrolls itself: give it a bounded height (h-full / flex-1
 * min-h-0). Designed for ~280–380 px width.
 */
export function NodeInspector({
  conversation,
  graph,
  node,
  multiFolder,
  onExpand,
  onAsk,
  onOpenRef,
  onOpenInEditor,
  onOpenGraph,
  onSelectNode,
  onClose,
  className,
}: NodeInspectorProps) {
  const spec = graph.spec;
  const visual = NODE_VISUALS[node.kind];
  const Icon = visual.icon;
  const expansion = expansionOfNode(conversation, graph.id, node.id);
  const children = childrenOfNode(conversation, graph.id, node.id);
  const { incoming, outgoing } = spec ? neighbours(spec, node.id) : { incoming: [], outgoing: [] };
  const byId = new Map<string, GraphNode>((spec?.nodes ?? []).map((n) => [n.id, n]));
  const expandable = node.expandable !== false;

  const edgeRow = (edge: GraphEdge, direction: 'in' | 'out') => {
    const otherId = direction === 'out' ? edge.to : edge.from;
    const other = byId.get(otherId);
    const OtherIcon = other ? NODE_VISUALS[other.kind].icon : null;
    const Arrow = direction === 'out' ? ArrowRight : ArrowLeft;
    const relation = edge.label ?? EDGE_KIND_INFO[edge.kind].label;
    return (
      <li key={`${direction}:${edge.id}`}>
        <button
          type="button"
          onClick={() => onSelectNode(otherId)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
        >
          <Arrow
            size={13}
            aria-label={direction === 'out' ? 'To' : 'From'}
            className="shrink-0 text-subtle"
          />
          {OtherIcon && other ? (
            <span className="kind-fg flex shrink-0" style={kindStyle(other.kind)}>
              <OtherIcon size={13} aria-hidden />
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-fg">{other?.label ?? otherId}</span>
          <span className="max-w-[45%] shrink-0 truncate text-xs text-muted">{relation}</span>
          {edge.step !== undefined ? (
            <span className="shrink-0 font-mono text-[11px] text-subtle tabular-nums">
              {edge.step}
            </span>
          ) : null}
        </button>
      </li>
    );
  };

  const refRow = (ref: CodeRef, index: number) => {
    const name = fileName(ref.path) || ref.folder || '.';
    const lines = lineRangeLabel(ref);
    const dir = dirName(ref.path);
    const where = [multiFolder && ref.folder ? ref.folder : '', dir].filter(Boolean).join(':');
    const secondary = [ref.symbol, where].filter(Boolean).join(' · ');
    const RefIcon = ref.isDir ? Folder : fileIcon(name);
    return (
      <li
        key={`${index}:${formatRef(ref)}`}
        className="group flex items-center rounded-md hover:bg-surface-2"
      >
        <Tooltip label={formatRef(ref, multiFolder)} delay={600} className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenRef(ref)}
            className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          >
            <RefIcon size={14} aria-hidden className="mt-px shrink-0 text-subtle" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-[12px] text-fg">
                {name}
                {lines ? <span className="text-subtle">:{lines}</span> : null}
              </span>
              {secondary ? (
                <span className="truncate font-mono text-[11px] text-subtle">{secondary}</span>
              ) : null}
            </span>
          </button>
        </Tooltip>
        <IconButton
          icon={SquareArrowOutUpRight}
          label="Open in editor"
          size="xs"
          onClick={() => onOpenInEditor(ref)}
          className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
        />
      </li>
    );
  };

  return (
    <aside
      aria-label={`Box: ${node.label}`}
      className={cn('flex min-h-0 flex-col overflow-y-auto', className)}
    >
      <div className="flex items-start gap-2.5 p-3 pb-2">
        <span
          className="kind-tint kind-fg flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border"
          style={kindStyle(node.kind)}
        >
          <Icon size={16} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-1 flex-col pt-px">
          <h2 className="text-sm leading-snug font-semibold break-words text-fg">{node.label}</h2>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Tooltip label={NODE_KIND_INFO[node.kind].hint} delay={500}>
              <span>{NODE_KIND_INFO[node.kind].label}</span>
            </Tooltip>
            {node.highlight ? (
              <Badge tone="accent" className="h-4! px-1.5! text-[10px]!">
                Key
              </Badge>
            ) : null}
          </div>
        </div>
        <IconButton icon={X} label="Close" onClick={onClose} className="-mt-0.5 -mr-1" />
      </div>

      {node.detail ? (
        <p className="px-3 pb-1 text-[13px] leading-relaxed text-fg/90">{node.detail}</p>
      ) : null}

      <div className="flex flex-col gap-1.5 p-3 pt-2">
        {expansion ? (
          <>
            <Button
              variant="primary"
              size="md"
              icon={isPending(expansion.status) ? undefined : EXPAND_ICON}
              onClick={() => onOpenGraph(expansion.id)}
              className="w-full"
            >
              {isPending(expansion.status) ? (
                <StatusIcon status={expansion.status} size={16} className="text-accent-fg!" />
              ) : null}
              <span className="flex-1 text-left">Open expansion</span>
              <ButtonKbd primary>E</ButtonKbd>
            </Button>
            <div className="flex gap-1.5">
              {expandable ? (
                <Button icon={RotateCcw} onClick={onExpand} className="flex-1">
                  <span className="flex-1 text-left">Expand again</span>
                </Button>
              ) : null}
              <Button icon={ASK_ICON} onClick={onAsk} className="flex-1">
                <span className="flex-1 text-left">Ask about this</span>
                <ButtonKbd>A</ButtonKbd>
              </Button>
            </div>
          </>
        ) : (
          <>
            {expandable ? (
              <Button
                variant="primary"
                size="md"
                icon={EXPAND_ICON}
                onClick={onExpand}
                className="w-full"
              >
                <span className="flex-1 text-left">Explain &amp; expand</span>
                <ButtonKbd primary>E</ButtonKbd>
              </Button>
            ) : null}
            <Button size="md" icon={ASK_ICON} onClick={onAsk} className="w-full">
              <span className="flex-1 text-left">Ask about this</span>
              <ButtonKbd>A</ButtonKbd>
            </Button>
          </>
        )}
      </div>

      {node.refs.length ? (
        <Section title="Code" count={node.refs.length}>
          <ul className="flex flex-col">{node.refs.map(refRow)}</ul>
        </Section>
      ) : null}

      {outgoing.length || incoming.length ? (
        <Section title="Connections" count={outgoing.length + incoming.length}>
          <ul className="flex flex-col">
            {outgoing.map((e) => edgeRow(e, 'out'))}
            {incoming.map((e) => edgeRow(e, 'in'))}
          </ul>
        </Section>
      ) : null}

      {children.length ? (
        <Section title="Diagrams from this box" count={children.length}>
          <ul className="flex flex-col">
            {children.map((child) => {
              const ChildIcon = ORIGIN_VISUALS[child.origin.type].icon;
              return (
                <li key={child.id}>
                  <button
                    type="button"
                    onClick={() => onOpenGraph(child.id)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
                  >
                    <ChildIcon
                      size={13}
                      aria-label={ORIGIN_VISUALS[child.origin.type].label}
                      className="shrink-0 text-subtle"
                    />
                    <span className="min-w-0 flex-1 truncate text-fg">
                      {graphDisplayTitle(child)}
                    </span>
                    {child.status !== 'done' ? (
                      <StatusIcon status={child.status} size={13} />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
    </aside>
  );
}
