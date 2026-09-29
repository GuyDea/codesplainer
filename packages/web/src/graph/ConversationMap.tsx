/**
 * Conversation map: every diagram of a conversation as a card, laid out as trees growing to the
 * right. Edges start on the box (inside the parent's thumbnail) that was expanded or asked about.
 */
import '@xyflow/react/dist/style.css';
import './graph.css';
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Network } from 'lucide-react';
import { parentIdOf, type GraphSpec } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { EmptyState, Spinner } from '../ui';
import { CanvasControls } from './canvas/CanvasControls';
import { exportFlowImage } from './canvas/export';
import { motion } from './canvas/motion';
import { layoutGraph, layoutKey } from './layout';
import { MapCard } from './map/MapCard';
import { MapContext } from './map/context';
import { MapEdge } from './map/MapEdge';
import { MAP_LAYOUT_OPTIONS } from './map/metrics';
import { buildMapModel } from './map/model';
import type { MapFlowEdge, MapFlowNode } from './map/types';
import { layoutMap, mapLayoutKey, peekMapLayout, type MapItem, type MapLayout } from './mapLayout';
import type { ConversationMapProps } from './types';

const NODE_TYPES: NodeTypes = { csCard: MapCard } as NodeTypes;
const EDGE_TYPES: EdgeTypes = { csMapEdge: MapEdge } as EdgeTypes;
const PRO_OPTIONS = { hideAttribution: true };
/** See GraphCanvas: declared sizes, not only already-measured nodes. */
const FIT_OPTIONS = { padding: 0.12, maxZoom: 1, minZoom: 0.1, includeHiddenNodes: true };

function thumbnailSpecs(specs: GraphSpec[]): GraphSpec[] {
  return specs.filter((s) => s.kind !== 'sequence');
}

function ConversationMapInner({
  conversation,
  currentGraphId,
  onOpenGraph,
  highlightQuery,
  className,
  ref,
}: ConversationMapProps) {
  const rf = useReactFlow<MapFlowNode, MapFlowEdge>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const graphs = conversation.graphs;

  const items = useMemo<MapItem[]>(
    () => graphs.map((g) => ({ id: g.id, parentId: parentIdOf(g.origin) })),
    [graphs],
  );
  const structureKey = mapLayoutKey(items, MAP_LAYOUT_OPTIONS);
  const doneSpecs = useMemo(
    () => graphs.filter((g) => g.status === 'done' && g.spec).map((g) => g.spec as GraphSpec),
    [graphs],
  );
  const thumbsKey = doneSpecs.map((s) => layoutKey(s)).join(',');

  // Thumbnails and ports need the real (ELK) layouts of every diagram: compute them first, then
  // the map layout. Until then the previous map stays on screen.
  const [layout, setLayout] = useState<MapLayout | null>(
    () => peekMapLayout(items, MAP_LAYOUT_OPTIONS) ?? null,
  );
  const [thumbsReadyKey, setThumbsReadyKey] = useState<string | null>(null);
  const latestItems = useRef(items);
  const latestSpecs = useRef(doneSpecs);
  useEffect(() => {
    latestItems.current = items;
    latestSpecs.current = doneSpecs;
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all(thumbnailSpecs(latestSpecs.current).map((s) => layoutGraph(s)));
      const next = await layoutMap(latestItems.current, MAP_LAYOUT_OPTIONS);
      if (cancelled) return;
      setLayout((prev) => (prev?.key === next.key ? prev : next));
      setThumbsReadyKey(thumbsKey);
    })();
    return () => {
      cancelled = true;
    };
  }, [structureKey, thumbsKey]);

  const model = useMemo(() => {
    if (!layout) return { nodes: [], edges: [] };
    return buildMapModel(conversation, layout, currentGraphId, highlightQuery);
    // thumbsReadyKey: rebuild ports once real thumbnail layouts are cached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation, layout, currentGraphId, highlightQuery, thumbsReadyKey]);

  // ---- viewport -----------------------------------------------------------------------------

  const [ready, setReady] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const fittedCount = useRef(0);
  const userMoved = useRef(false);
  const fit = useCallback(
    (duration = 300) => rf.fitView({ ...FIT_OPTIONS, duration: motion(duration) }),
    [rf],
  );
  const count = model.nodes.length;
  const hasGraphs = graphs.length > 0;

  // Fit on mount and whenever diagrams are added.
  useEffect(() => {
    if (!count || !initialized) return;
    const first = fittedCount.current === 0;
    const grew = count > fittedCount.current;
    fittedCount.current = count;
    if (!grew) return;
    userMoved.current = false;
    void fit(first ? 0 : 320).then(() => setReady(true));
  }, [count, initialized, fit]);

  // Never stay invisible, even if React Flow drops a fit request.
  useEffect(() => {
    if (ready || !count) return;
    const timer = window.setTimeout(() => setReady(true), 600);
    return () => window.clearTimeout(timer);
  }, [ready, count]);

  // Refit when the panel is resized, until the user moves the view.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!userMoved.current && fittedCount.current > 0) void fit(0);
      });
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fit, hasGraphs]);

  useImperativeHandle(
    ref,
    () => ({
      fitView: () => {
        userMoved.current = false;
        void fit(300);
      },
      toImage: async (format) => {
        const el = wrapperRef.current;
        if (!el) throw new Error('Map is not mounted.');
        return exportFlowImage(el, rf.getNodesBounds(rf.getNodes()), format);
      },
    }),
    [fit, rf],
  );

  const mapContext = useMemo(() => ({ open: onOpenGraph }), [onOpenGraph]);

  if (graphs.length === 0) {
    return (
      <div
        className={cn('flex h-full w-full items-center justify-center bg-canvas', className)}
        data-testid="conversation-map"
      >
        <EmptyState
          icon={Network}
          title="No diagrams yet"
          description="Ask a question. Every answer and every expanded box shows up here as a map."
        />
      </div>
    );
  }

  return (
    <MapContext.Provider value={mapContext}>
      <div
        ref={wrapperRef}
        className={cn('relative h-full w-full overflow-hidden bg-canvas', className)}
        data-testid="conversation-map"
        role="group"
        aria-roledescription="conversation map"
        aria-label={`${conversation.title}: ${graphs.length} diagrams`}
      >
        <ReactFlow<MapFlowNode, MapFlowEdge>
          className={cn(
            'cs-flow transition-opacity duration-200',
            ready ? 'opacity-100' : 'opacity-0',
          )}
          nodes={model.nodes}
          edges={model.edges}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          proOptions={PRO_OPTIONS}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode={null}
          zoomOnDoubleClick={false}
          minZoom={0.1}
          maxZoom={1.6}
          onInit={() => setInitialized(true)}
          onMoveStart={(event) => {
            if (event) userMoved.current = true;
          }}
          onNodeClick={(_, node) => onOpenGraph(node.id)}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.3} />
          <CanvasControls
            onFit={() => {
              userMoved.current = false;
              void fit(300);
            }}
          />
        </ReactFlow>
        {!ready && hasGraphs ? (
          // First layouts (ELK loads lazily): a quiet spinner, only if it takes a moment.
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner
              size={18}
              className="text-subtle opacity-0 [animation:cs-fade_160ms_ease-out_250ms_forwards]"
            />
          </div>
        ) : null}
      </div>
    </MapContext.Provider>
  );
}

export function ConversationMap(props: ConversationMapProps) {
  return (
    <ReactFlowProvider>
      <ConversationMapInner {...props} />
    </ReactFlowProvider>
  );
}
