/** React Flow node / edge types used by GraphCanvas. */
import type { Edge, Node } from '@xyflow/react';
import type { GraphEdge, GraphNode } from '@codesplainer/shared';
import type { Point, Rect } from '../layout';
import type { NodeChildInfo } from '../types';

export type DiagramNodeData = {
  node: GraphNode;
  labelLines: number;
  detailLines: number;
  children: NodeChildInfo[];
  /** Enter animation delay (ms). */
  delay: number;
  /** Re-mount key for enter animations (changes with every new layout). */
  layoutKey: string;
};
export type DiagramFlowNode = Node<DiagramNodeData, 'csNode'>;

export type GroupNodeData = { label: string; delay: number; layoutKey: string };
export type GroupFlowNode = Node<GroupNodeData, 'csGroup'>;

export type LifelineNodeData = { delay: number; layoutKey: string };
export type LifelineFlowNode = Node<LifelineNodeData, 'csLifeline'>;

export type CanvasNode = DiagramFlowNode | GroupFlowNode | LifelineFlowNode;

export type DiagramEdgeData = {
  edge: GraphEdge;
  /** Absolute route (ELK / sequence). Missing: a step path between the handles is used. */
  points?: Point[];
  /** Label box (top-left + size). Missing: the label is centered on the route midpoint. */
  label?: Rect;
  /** Emphasized (touches the hovered or selected box). */
  active: boolean;
  /** De-emphasized (hover focus elsewhere, or a step the player has not reached yet). */
  dim: boolean;
  /** Part of the step player's current step. */
  current: boolean;
  delay: number;
  layoutKey: string;
};
export type DiagramFlowEdge = Edge<DiagramEdgeData, 'csEdge'>;
