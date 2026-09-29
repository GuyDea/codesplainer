/**
 * Public contract of the graph module (src/graph). The app shell only uses what is exported from
 * src/graph/index.ts and these prop types.
 *
 * Additions beyond the original contract (all optional / additive):
 * - GraphThumbnailProps.markedNodeIds: boxes drawn with an accent outline.
 * - thumbnailBoxes(spec, width, height): node rects in thumbnail coordinates (same geometry as
 *   GraphThumbnail draws; the conversation map puts its edge ports there).
 * - layoutGraph(spec, { direction?, multiFolder? }) / peekGraphLayout(...): the memoized ELK
 *   layout (e.g. to warm the cache); GraphLayout, LayoutRect types.
 * - refChipText(ref, multiFolder) / refTitle(ref): the text of a box's ref chip / its tooltip.
 * - preferredChild(children): the child diagram a badge click opens (latest done, else latest).
 *
 * Sizing: GraphCanvas and ConversationMap fill their parent (h-full w-full); the parent needs a
 * definite height. Both refit on container resize until the user pans or zooms.
 */
import type { Ref } from 'react';
import type {
  CodeRef,
  Conversation,
  GraphDirection,
  GraphSpec,
  GraphStatus,
} from '@codesplainer/shared';

/** A diagram that was created from a node (expansion or node question). */
export interface NodeChildInfo {
  graphId: string;
  type: 'expand' | 'ask-node' | 'ask-code';
  status: GraphStatus;
  title: string;
}

export interface GraphCanvasHandle {
  fitView(): void;
  /** Center and select-highlight a node. */
  focusNode(nodeId: string): void;
  /** Render the current diagram to an image data URL (whole diagram, not just the viewport). */
  toImage(format: 'png' | 'svg'): Promise<string>;
}

export interface GraphCanvasProps {
  /** Id of the diagram (GraphEntry.id). Changing it re-layouts and fits the view. */
  graphId: string;
  spec: GraphSpec;
  selectedNodeId?: string | null;
  selectedEdgeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  onSelectEdge?: (edgeId: string | null) => void;
  /** "Explain & expand" (double-click, node toolbar, context menu, Enter/E key). */
  onExpandNode?: (nodeId: string) => void;
  /** "Ask about this box" (node toolbar, context menu, A key). */
  onAskNode?: (nodeId: string) => void;
  /** Open a code reference (ref chip on a node). */
  onOpenRef?: (ref: CodeRef) => void;
  /** Open a child diagram (badge on an already expanded node). */
  onOpenChild?: (graphId: string) => void;
  /** Child diagrams per node id, oldest first. */
  nodeChildren?: Record<string, NodeChildInfo[]>;
  /** Override the layout direction (default: spec.direction or by kind). */
  direction?: GraphDirection;
  showMinimap?: boolean;
  /** Show folder alias in ref chips (multi-folder workspaces). */
  multiFolder?: boolean;
  className?: string;
  ref?: Ref<GraphCanvasHandle>;
}

export interface ConversationMapHandle {
  fitView(): void;
  toImage(format: 'png' | 'svg'): Promise<string>;
}

export interface ConversationMapProps {
  conversation: Conversation;
  currentGraphId?: string | null;
  onOpenGraph: (graphId: string) => void;
  /** Dim cards that do not match (title/question/node labels). */
  highlightQuery?: string;
  className?: string;
  ref?: Ref<ConversationMapHandle>;
}

export interface GraphThumbnailProps {
  spec: GraphSpec;
  width?: number;
  height?: number;
  /** Emphasize one node (e.g. the node that was expanded). */
  highlightNodeId?: string;
  /**
   * (Added) Nodes drawn with an accent outline, e.g. every box that has child diagrams. Used by
   * the conversation map to mark where its edges start.
   */
  markedNodeIds?: string[];
  className?: string;
}

export interface LegendProps {
  spec: GraphSpec;
  className?: string;
}
