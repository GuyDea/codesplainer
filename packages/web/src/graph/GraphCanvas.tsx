/**
 * The diagram canvas: ELK-laid-out boxes (or a sequence layout) rendered with React Flow.
 * Selection is controlled when `selectedNodeId` / `selectedEdgeId` are passed, internal otherwise.
 */
import '@xyflow/react/dist/style.css';
import './graph.css';
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import { Copy, CodeXml, Maximize2, MessageSquare } from 'lucide-react';
import {
  defaultDirection,
  NODE_KIND_INFO,
  type CodeRef,
  type GraphDirection,
  type GraphSpec,
} from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { Spinner, type MenuItem } from '../ui';
import { CanvasControls } from './canvas/CanvasControls';
import { CanvasContext, type CanvasContextValue } from './canvas/context';
import { exportFlowImage } from './canvas/export';
import { motion } from './canvas/motion';
import { ARROW_KEYS, isInteractiveTarget, nearestInDirection, startBox } from './canvas/keyboard';
import type { CanvasNode, DiagramFlowEdge, DiagramFlowNode } from './canvas/types';
import { ContextMenu } from './ContextMenu';
import { DiagramEdge } from './edges/DiagramEdge';
import { layoutGraph, peekGraphLayout, type GraphLayout, type Rect } from './layout';
import { DiagramNode } from './nodes/DiagramNode';
import { GroupNode, LifelineNode } from './nodes/GroupNode';
import { sequenceLayout, type SequenceLayout } from './sequence';
import type { GraphCanvasProps, NodeChildInfo } from './types';
import { NODE_VISUALS } from './visuals';

const NODE_TYPES: NodeTypes = {
  csNode: DiagramNode,
  csGroup: GroupNode,
  csLifeline: LifelineNode,
} as NodeTypes;
const EDGE_TYPES: EdgeTypes = { csEdge: DiagramEdge } as EdgeTypes;
const PRO_OPTIONS = { hideAttribution: true };
/**
 * `includeHiddenNodes` makes React Flow use the declared node sizes: otherwise fitView only
 * counts nodes that were already measured in the DOM, which right after a layout is a subset.
 * (No node is ever hidden here.)
 */
const FIT_OPTIONS = { padding: 0.18, maxZoom: 1.25, minZoom: 0.15, includeHiddenNodes: true };
const EMPTY_CHILDREN: NodeChildInfo[] = [];
/** Longer than a double-click, so the second click still hits the same box. */
const RESIZE_REFIT_DELAY_MS = 450;

function viewportChanged(a: Viewport, b: Viewport): boolean {
  return Math.abs(a.x - b.x) > 2 || Math.abs(a.y - b.y) > 2 || Math.abs(a.zoom - b.zoom) > 0.001;
}

interface DiagramModel {
  graphId: string;
  spec: GraphSpec;
  direction: GraphDirection;
  key: string;
  layout?: GraphLayout;
  sequence?: SequenceLayout;
}

/**
 * Direction picked per diagram when the caller did not force one: the agent's direction is a
 * preference, but when the other direction fits the viewport clearly better (long chains in a
 * wide or tall canvas) that one wins. Remembered so revisits and re-renders never flip it.
 */
const chosenDirections = new Map<string, GraphDirection>();
const MAX_REMEMBERED_DIRECTIONS = 300;
/** The other direction must allow at least this much more zoom to replace the preferred one. */
const AUTO_DIRECTION_GAIN = 1.2;

function rememberDirection(signature: string, direction: GraphDirection): void {
  chosenDirections.set(signature, direction);
  if (chosenDirections.size > MAX_REMEMBERED_DIRECTIONS) {
    const oldest = chosenDirections.keys().next().value;
    if (oldest !== undefined) chosenDirections.delete(oldest);
  }
}

/** Zoom at which fitView would show the whole layout in a viewport of the given size. */
function fitZoom(layout: GraphLayout, size: { width: number; height: number }): number {
  const pad = 1 + FIT_OPTIONS.padding * 2;
  return Math.min(
    FIT_OPTIONS.maxZoom,
    size.width / Math.max(1, layout.width * pad),
    size.height / Math.max(1, layout.height * pad),
  );
}

/** Layout of the current spec. While a new ELK layout runs, the previous model stays visible. */
function useDiagramModel(
  graphId: string,
  spec: GraphSpec,
  preferred: GraphDirection,
  fixed: boolean,
  multiFolder: boolean,
  measure: () => { width: number; height: number } | null,
): DiagramModel | null {
  const signature = `${graphId}|${spec.kind}|${spec.nodes.map((n) => n.id).join(',')}|${spec.edges.length}|${multiFolder ? 1 : 0}`;
  const sync = useMemo<DiagramModel | null>(() => {
    if (spec.kind === 'sequence') {
      const sequence = sequenceLayout(spec, { direction: preferred, multiFolder });
      return { graphId, spec, direction: preferred, key: sequence.key, sequence };
    }
    const direction = fixed ? preferred : chosenDirections.get(signature);
    if (!direction) return null;
    const cached = peekGraphLayout(spec, { direction, multiFolder });
    return cached ? { graphId, spec, direction, key: cached.key, layout: cached } : null;
  }, [graphId, spec, preferred, fixed, multiFolder, signature]);
  const [computed, setComputed] = useState<DiagramModel | null>(null);
  useEffect(() => {
    if (sync) return;
    let cancelled = false;
    void (async () => {
      let direction = fixed ? preferred : chosenDirections.get(signature);
      let layout: GraphLayout;
      if (direction) {
        layout = await layoutGraph(spec, { direction, multiFolder });
      } else {
        const alternative: GraphDirection = preferred === 'LR' ? 'TB' : 'LR';
        const [first, second] = await Promise.all([
          layoutGraph(spec, { direction: preferred, multiFolder }),
          layoutGraph(spec, { direction: alternative, multiFolder }),
        ]);
        const size = measure() ?? { width: 1200, height: 750 };
        const useAlternative = fitZoom(second, size) > fitZoom(first, size) * AUTO_DIRECTION_GAIN;
        direction = useAlternative ? alternative : preferred;
        layout = useAlternative ? second : first;
        rememberDirection(signature, direction);
      }
      if (!cancelled) setComputed({ graphId, spec, direction, key: layout.key, layout });
    })();
    return () => {
      cancelled = true;
    };
  }, [sync, graphId, spec, preferred, fixed, multiFolder, signature, measure]);
  return sync ?? computed;
}

/** Controlled-or-uncontrolled selection value. */
function useSelection(
  controlled: string | null | undefined,
  onChange: ((id: string | null) => void) | undefined,
): [string | null, (id: string | null) => void] {
  const [inner, setInner] = useState<string | null>(null);
  const value = controlled !== undefined ? controlled : inner;
  const onChangeRef = useRef(onChange);
  useLayoutEffect(() => {
    onChangeRef.current = onChange;
  });
  const set = useCallback(
    (id: string | null) => {
      if (controlled === undefined) setInner(id);
      onChangeRef.current?.(id);
    },
    [controlled],
  );
  return [value, set];
}

function minimapColor(node: CanvasNode): string {
  if (node.type !== 'csNode') return 'transparent';
  const v = NODE_VISUALS[(node as DiagramFlowNode).data.node.kind];
  return `oklch(0.7 ${(0.1 * v.chroma).toFixed(3)} ${v.hue} / 0.85)`;
}

function GraphCanvasInner(props: GraphCanvasProps) {
  const {
    graphId,
    spec,
    nodeChildren,
    multiFolder = false,
    showMinimap = false,
    className,
    ref,
  } = props;
  const direction = props.direction ?? defaultDirection(spec);
  const rf = useReactFlow<CanvasNode, DiagramFlowEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const measure = useCallback(() => {
    const el = wrapperRef.current;
    return el && el.clientWidth > 0 && el.clientHeight > 0
      ? { width: el.clientWidth, height: el.clientHeight }
      : null;
  }, []);
  const model = useDiagramModel(
    graphId,
    spec,
    direction,
    props.direction !== undefined,
    multiFolder,
    measure,
  );
  const [selectedNodeId, setSelectedNode] = useSelection(props.selectedNodeId, props.onSelectNode);
  const [selectedEdgeId, setSelectedEdge] = useSelection(props.selectedEdgeId, props.onSelectEdge);
  const [hovered, setHovered] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  /** React Flow's viewport (d3-zoom) is set up; fitView before that is silently dropped. */
  const [initialized, setInitialized] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  const userMoved = useRef(false);
  const moveStart = useRef<Viewport | null>(null);
  const fittedKey = useRef<string | null>(null);

  const selectNode = useCallback(
    (id: string | null) => {
      if (id !== selectedNodeId) setSelectedNode(id);
      if (id && selectedEdgeId) setSelectedEdge(null);
    },
    [selectedNodeId, selectedEdgeId, setSelectedNode, setSelectedEdge],
  );
  const selectEdge = useCallback(
    (id: string | null) => {
      if (id !== selectedEdgeId) setSelectedEdge(id);
      if (id && selectedNodeId) setSelectedNode(null);
    },
    [selectedNodeId, selectedEdgeId, setSelectedNode, setSelectedEdge],
  );

  const nodeById = useMemo(
    () => new Map((model?.spec ?? spec).nodes.map((n) => [n.id, n])),
    [model, spec],
  );

  const expand = useCallback(
    (id: string) => {
      const node = nodeById.get(id);
      if (!node || node.expandable === false) return;
      latest.current.onExpandNode?.(id);
    },
    [nodeById],
  );
  const ask = useCallback((id: string) => latest.current.onAskNode?.(id), []);
  const openRef = useCallback((r: CodeRef) => latest.current.onOpenRef?.(r), []);
  const openChild = useCallback((id: string) => latest.current.onOpenChild?.(id), []);
  const hover = useCallback((id: string | null) => {
    window.clearTimeout(hoverTimer.current);
    if (id) setHovered(id);
    else hoverTimer.current = window.setTimeout(() => setHovered(null), 140);
  }, []);
  const holdHover = useCallback(() => window.clearTimeout(hoverTimer.current), []);
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const fit = useCallback(
    (duration = 300) => rf.fitView({ ...FIT_OPTIONS, duration: motion(duration) }),
    [rf],
  );

  // ---- nodes & edges ------------------------------------------------------------------------

  const focus = useMemo(() => {
    if (!hovered || !model) return null;
    const set = new Set([hovered]);
    for (const e of model.spec.edges) {
      if (e.from === hovered) set.add(e.to);
      if (e.to === hovered) set.add(e.from);
    }
    return set;
  }, [hovered, model]);

  const boxes = useMemo<(Rect & { id: string; highlight?: boolean })[]>(() => {
    if (!model) return [];
    const rects: Record<string, Rect> = model.layout?.nodes ?? model.sequence?.participants ?? {};
    return model.spec.nodes
      .filter((n) => rects[n.id])
      .map((n) => ({ ...(rects[n.id] as Rect), id: n.id, highlight: n.highlight }));
  }, [model]);

  const nodes = useMemo<CanvasNode[]>(() => {
    if (!model) return [];
    const out: CanvasNode[] = [];
    const key = model.key;
    const width = model.layout?.width ?? model.sequence?.width ?? 1;
    const height = model.layout?.height ?? model.sequence?.height ?? 1;
    const tb = model.layout?.direction === 'TB';
    const delayOf = (r: Rect) =>
      Math.round((tb ? r.y / Math.max(1, height) : r.x / Math.max(1, width)) * 160);
    for (const g of model.layout?.groups ?? []) {
      out.push({
        id: `group:${g.id}`,
        type: 'csGroup',
        position: { x: g.x, y: g.y },
        width: g.width,
        height: g.height,
        data: { label: g.label, delay: delayOf(g), layoutKey: key },
        selectable: false,
        focusable: false,
        draggable: false,
        zIndex: -1,
        style: { pointerEvents: 'none' },
      });
    }
    for (const line of model.sequence?.lifelines ?? []) {
      out.push({
        id: `lifeline:${line.id}`,
        type: 'csLifeline',
        position: { x: line.x - 1, y: line.top },
        width: 2,
        height: Math.max(1, line.bottom - line.top),
        data: { delay: 60, layoutKey: key },
        selectable: false,
        focusable: false,
        draggable: false,
        zIndex: -1,
        style: { pointerEvents: 'none' },
      });
    }
    const rects: Record<string, Rect & { labelLines: number; detailLines: number }> =
      model.layout?.nodes ?? model.sequence?.participants ?? {};
    for (const node of model.spec.nodes) {
      const box = rects[node.id];
      if (!box) continue;
      out.push({
        id: node.id,
        type: 'csNode',
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        data: {
          node,
          labelLines: box.labelLines,
          detailLines: box.detailLines,
          children: nodeChildren?.[node.id] ?? EMPTY_CHILDREN,
          delay: delayOf(box),
          layoutKey: key,
        },
        selected: node.id === selectedNodeId,
        draggable: false,
        ariaLabel: `${node.label} (${NODE_KIND_INFO[node.kind].label})`,
        className: focus && !focus.has(node.id) ? 'cs-dim' : undefined,
      });
    }
    return out;
  }, [model, nodeChildren, selectedNodeId, focus]);

  const edges = useMemo<DiagramFlowEdge[]>(() => {
    if (!model) return [];
    const key = model.key;
    const byId = new Map(model.spec.edges.map((e) => [e.id, e]));
    const anchor = hovered ?? selectedNodeId;
    const items = model.sequence
      ? model.sequence.messages.map((m, i) => ({
          edge: byId.get(m.id),
          points: m.points,
          label: m.label,
          delay: 120 + i * 25,
        }))
      : model.spec.edges.map((e) => ({
          edge: e,
          points: model.layout?.edges[e.id]?.points,
          label: model.layout?.edges[e.id]?.label,
          delay: 140,
        }));
    const out: DiagramFlowEdge[] = [];
    for (const item of items) {
      const edge = item.edge;
      if (!edge || !nodeById.has(edge.from) || !nodeById.has(edge.to)) continue;
      const touches = anchor ? edge.from === anchor || edge.to === anchor : false;
      out.push({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'csEdge',
        selected: edge.id === selectedEdgeId,
        data: {
          edge,
          points: item.points,
          label: item.label,
          active: touches,
          dim: hovered ? !touches : false,
          delay: item.delay,
          layoutKey: key,
        },
        ariaLabel: `${nodeById.get(edge.from)?.label} to ${nodeById.get(edge.to)?.label}${edge.label ? `: ${edge.label}` : ''}`,
      });
    }
    return out;
  }, [model, nodeById, hovered, selectedNodeId, selectedEdgeId]);

  // ---- viewport -----------------------------------------------------------------------------

  useEffect(() => {
    if (!initialized || !model || fittedKey.current === model.key) return;
    const first = fittedKey.current === null;
    fittedKey.current = model.key;
    userMoved.current = false;
    void fit(first ? 0 : 320).then(() => setReady(true));
  }, [initialized, model, fit]);

  // Never leave the canvas invisible, even if React Flow drops a fit request.
  useEffect(() => {
    if (ready || !model) return;
    const timer = window.setTimeout(() => setReady(true), 600);
    return () => window.clearTimeout(timer);
  }, [ready, model]);

  // Refit when the container is resized (e.g. the inspector opens), until the user moves the
  // view. Debounced past the double-click window, so a box doesn't jump away between the two
  // clicks of a double-click (the first click opens the inspector and shrinks the canvas).
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!userMoved.current && fittedKey.current) void fit(200);
      }, RESIZE_REFIT_DELAY_MS);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [fit]);

  const focusNode = useCallback(
    (id: string) => {
      const node = rf.getNode(id);
      if (!node) return;
      const w = node.width ?? 0;
      const h = node.height ?? 0;
      userMoved.current = true;
      void rf.setCenter(node.position.x + w / 2, node.position.y + h / 2, {
        zoom: Math.max(rf.getZoom(), 1),
        duration: motion(360),
      });
      selectNode(id);
    },
    [rf, selectNode],
  );

  /** Pan (without zooming) so a box is fully visible. */
  const revealNode = useCallback(
    (id: string) => {
      const node = rf.getNode(id);
      const el = wrapperRef.current;
      if (!node || !el) return;
      const { x, y, zoom } = rf.getViewport();
      const w = (node.width ?? 0) * zoom;
      const h = (node.height ?? 0) * zoom;
      const sx = node.position.x * zoom + x;
      const sy = node.position.y * zoom + y;
      const margin = 48;
      const outside =
        sx < margin ||
        sy < margin ||
        sx + w > el.clientWidth - margin ||
        sy + h > el.clientHeight - margin;
      if (outside) {
        void rf.setCenter(
          node.position.x + (node.width ?? 0) / 2,
          node.position.y + (node.height ?? 0) / 2,
          {
            zoom,
            duration: motion(240),
          },
        );
      }
    },
    [rf],
  );

  useImperativeHandle(
    ref,
    () => ({
      fitView: () => {
        userMoved.current = false;
        void fit(300);
      },
      focusNode,
      toImage: async (format) => {
        const el = wrapperRef.current;
        if (!el) throw new Error('Canvas is not mounted.');
        setHovered(null);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        return exportFlowImage(el, rf.getNodesBounds(rf.getNodes()), format);
      },
    }),
    [fit, focusNode, rf],
  );

  // ---- interaction --------------------------------------------------------------------------

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // Keys on toolbar buttons, chips, badges (or text fields) belong to those elements.
    if (event.target !== event.currentTarget && isInteractiveTarget(event.target)) return;
    const dir = ARROW_KEYS[event.key];
    if (dir) {
      event.preventDefault();
      const next =
        selectedNodeId && boxes.some((b) => b.id === selectedNodeId)
          ? nearestInDirection(boxes, selectedNodeId, dir)
          : startBox(boxes);
      if (next) {
        selectNode(next);
        revealNode(next);
      }
      return;
    }
    const key = event.key.toLowerCase();
    if ((event.key === 'Enter' || key === 'e') && selectedNodeId) {
      event.preventDefault();
      expand(selectedNodeId);
    } else if (key === 'a' && selectedNodeId) {
      event.preventDefault();
      ask(selectedNodeId);
    } else if (event.key === 'Escape') {
      if (selectedNodeId || selectedEdgeId || menu) event.preventDefault();
      setMenu(null);
      selectNode(null);
      selectEdge(null);
    } else if (key === 'f') {
      event.preventDefault();
      userMoved.current = false;
      void fit(300);
    }
  };

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: CanvasNode) => {
      if (node.type !== 'csNode') return;
      event.preventDefault();
      selectNode(node.id);
      setMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
    },
    [selectNode],
  );

  const menuItems = useMemo<MenuItem[]>(() => {
    const node = menu ? nodeById.get(menu.nodeId) : undefined;
    if (!node) return [];
    const p = latest.current;
    const firstRef = node.refs[0];
    return [
      { type: 'label', id: 'title', label: node.label },
      {
        id: 'expand',
        label: 'Explain & expand',
        icon: Maximize2,
        shortcut: 'E',
        disabled: !p.onExpandNode || node.expandable === false,
        onSelect: () => expand(node.id),
      },
      {
        id: 'ask',
        label: 'Ask about this',
        icon: MessageSquare,
        shortcut: 'A',
        disabled: !p.onAskNode,
        onSelect: () => ask(node.id),
      },
      {
        id: 'code',
        label: 'Open code',
        icon: CodeXml,
        disabled: !p.onOpenRef || !firstRef,
        onSelect: () => firstRef && openRef(firstRef),
      },
      { type: 'separator', id: 'sep' },
      {
        id: 'copy',
        label: 'Copy label',
        icon: Copy,
        onSelect: () => void navigator.clipboard?.writeText(node.label).catch(() => {}),
      },
    ];
  }, [menu, nodeById, expand, ask, openRef]);

  const context = useMemo<CanvasContextValue>(
    () => ({
      direction: model?.layout?.direction ?? direction,
      multiFolder,
      toolbarNodeId: menu ? null : (hovered ?? selectedNodeId),
      canExpand: Boolean(props.onExpandNode),
      canAsk: Boolean(props.onAskNode),
      canOpenRef: Boolean(props.onOpenRef),
      canOpenChild: Boolean(props.onOpenChild),
      expand,
      ask,
      openRef,
      openChild,
      selectEdge: (id) => selectEdge(id),
      hover,
      holdHover,
    }),
    [
      model,
      direction,
      multiFolder,
      menu,
      hovered,
      selectedNodeId,
      props.onExpandNode,
      props.onAskNode,
      props.onOpenRef,
      props.onOpenChild,
      expand,
      ask,
      openRef,
      openChild,
      selectEdge,
      hover,
      holdHover,
    ],
  );

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;

  return (
    <CanvasContext.Provider value={context}>
      <div
        ref={wrapperRef}
        className={cn(
          'cs-canvas relative h-full w-full overflow-hidden bg-canvas outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset',
          className,
        )}
        tabIndex={0}
        role="group"
        aria-roledescription="diagram"
        aria-label={`${spec.title}. Arrow keys move between boxes, Enter expands, A asks, F fits.`}
        onKeyDown={onKeyDown}
        data-testid="graph-canvas"
      >
        <ReactFlow<CanvasNode, DiagramFlowEdge>
          className={cn(
            'cs-flow transition-opacity duration-200',
            ready ? 'opacity-100' : 'opacity-0',
          )}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          proOptions={PRO_OPTIONS}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          selectNodesOnDrag={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          minZoom={0.15}
          maxZoom={2.5}
          onInit={() => setInitialized(true)}
          onNodeClick={(_, node) => {
            if (node.type === 'csNode') selectNode(node.id);
          }}
          onNodeDoubleClick={(_, node) => {
            if (node.type === 'csNode') expand(node.id);
          }}
          onNodeContextMenu={onNodeContextMenu}
          onNodeMouseEnter={(_, node) => {
            if (node.type === 'csNode') hover(node.id);
          }}
          onNodeMouseLeave={(_, node) => {
            if (node.type === 'csNode') hover(null);
          }}
          onEdgeClick={(_, edge) => selectEdge(edge.id)}
          onPaneClick={() => {
            setMenu(null);
            selectNode(null);
            selectEdge(null);
          }}
          onPaneContextMenu={(event) => event.preventDefault()}
          onMoveStart={(event, viewport) => {
            // Boxes are not draggable, so pressing one starts a (zero-length) pan: only count
            // it as "the user moved the view" once the viewport actually changed.
            moveStart.current = event ? viewport : null;
            setMenu(null);
          }}
          onMoveEnd={(event, viewport) => {
            const start = moveStart.current;
            moveStart.current = null;
            if (event && start && viewportChanged(start, viewport)) userMoved.current = true;
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} />
          {showMinimap ? (
            <MiniMap<CanvasNode>
              position="bottom-left"
              pannable
              zoomable
              nodeColor={minimapColor}
              nodeStrokeWidth={0}
              nodeBorderRadius={4}
              className="cs-no-export"
              ariaLabel="Mini map"
            />
          ) : null}
          <CanvasControls
            onFit={() => {
              userMoved.current = false;
              void fit(300);
            }}
          />
        </ReactFlow>
        {!model ? (
          // First layout (ELK loads lazily): a quiet spinner, only if it takes a moment.
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner
              size={18}
              className="text-subtle opacity-0 [animation:cs-fade_160ms_ease-out_250ms_forwards]"
            />
          </div>
        ) : null}
        {menu && menuItems.length ? (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            items={menuItems}
            label="Box actions"
            onClose={() => {
              setMenu(null);
              wrapperRef.current?.focus();
            }}
          />
        ) : null}
        <div className="sr-only" aria-live="polite">
          {selectedNode ? `${selectedNode.label}, ${NODE_KIND_INFO[selectedNode.kind].label}` : ''}
        </div>
      </div>
    </CanvasContext.Provider>
  );
}

export function GraphCanvas(props: GraphCanvasProps) {
  return (
    <ReactFlowProvider>
      <GraphCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
