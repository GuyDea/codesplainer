import { createContext, useContext } from 'react';
import type { CodeRef, GraphDirection } from '@codesplainer/shared';

/** Actions and view state shared by the custom nodes and edges of a GraphCanvas. */
export interface CanvasContextValue {
  direction: GraphDirection;
  multiFolder: boolean;
  /** Box whose hover toolbar is shown. */
  toolbarNodeId: string | null;
  canExpand: boolean;
  canAsk: boolean;
  canOpenRef: boolean;
  canOpenChild: boolean;
  expand(nodeId: string): void;
  ask(nodeId: string): void;
  openRef(ref: CodeRef): void;
  openChild(graphId: string): void;
  selectEdge(edgeId: string): void;
  /** Hover in (id) or out (null, applied after a short grace period). */
  hover(nodeId: string | null): void;
  /** Keep the current hover (pointer moved onto a toolbar / popover). */
  holdHover(): void;
}

const noop = () => {};

export const CanvasContext = createContext<CanvasContextValue>({
  direction: 'LR',
  multiFolder: false,
  toolbarNodeId: null,
  canExpand: false,
  canAsk: false,
  canOpenRef: false,
  canOpenChild: false,
  expand: noop,
  ask: noop,
  openRef: noop,
  openChild: noop,
  selectEdge: noop,
  hover: noop,
  holdHover: noop,
});

export function useCanvas(): CanvasContextValue {
  return useContext(CanvasContext);
}
