import type { Edge, Node } from '@xyflow/react';
import type { GraphEntry } from '@codesplainer/shared';

export type MapPort = { id: string; x: number; y: number };

export type MapCardData = {
  entry: GraphEntry;
  title: string;
  relation: string;
  isCurrent: boolean;
  dim: boolean;
  /** Source handles placed on thumbnail boxes that have child diagrams (card coordinates). */
  ports: MapPort[];
  /** Boxes with child diagrams (outlined in the thumbnail). */
  marked: string[];
};
export type MapFlowNode = Node<MapCardData, 'csCard'>;

export type MapRelation = 'expand' | 'ask' | 'follow-up' | 'code';

export type MapEdgeData = {
  relation: MapRelation;
  /** What the relation is about (box label, file name). */
  subject?: string;
  /** Right border of the parent card: the edge runs straight to it before curving. */
  exitX: number;
  /** The edge starts on a thumbnail box (draws a port dot). */
  fromPort: boolean;
  dim: boolean;
};
export type MapFlowEdge = Edge<MapEdgeData, 'csMapEdge'>;
