/**
 * Visual vocabulary shared by every view: icon + color per node kind, line style per edge kind,
 * icons for diagram kinds, origins (how a diagram was created) and statuses.
 * Colors are OKLCH hue/chroma pairs consumed by the .kind-* classes in styles.css.
 */
import type { CSSProperties } from 'react';
import {
  AppWindow,
  ArrowRightLeft,
  Boxes,
  Box,
  Braces,
  Circle,
  CircleCheck,
  CircleDot,
  CircleStop,
  CircleX,
  Clock,
  Cloud,
  CodeXml,
  Component,
  Crosshair,
  Database,
  Diamond,
  FileCode,
  FlaskConical,
  Footprints,
  GitFork,
  Inbox,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  MessagesSquare,
  Network,
  Package,
  Server,
  Settings2,
  SquareFunction,
  User,
  Waypoints,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type {
  EdgeKind,
  GraphKind,
  GraphOriginType,
  GraphStatus,
  NodeKind,
} from '@codesplainer/shared';

export interface KindVisual {
  icon: LucideIcon;
  /** OKLCH hue in degrees. */
  hue: number;
  /** Chroma factor 0..1 (0 = grey). */
  chroma: number;
}

export const NODE_VISUALS: Record<NodeKind, KindVisual> = {
  actor: { icon: User, hue: 30, chroma: 1 },
  ui: { icon: AppWindow, hue: 305, chroma: 1 },
  service: { icon: Server, hue: 255, chroma: 1 },
  module: { icon: Package, hue: 215, chroma: 0.9 },
  component: { icon: Component, hue: 275, chroma: 0.9 },
  class: { icon: Box, hue: 285, chroma: 0.8 },
  function: { icon: SquareFunction, hue: 155, chroma: 1 },
  data: { icon: Braces, hue: 85, chroma: 1 },
  store: { icon: Database, hue: 45, chroma: 1 },
  external: { icon: Cloud, hue: 250, chroma: 0.15 },
  queue: { icon: Inbox, hue: 335, chroma: 0.9 },
  config: { icon: Settings2, hue: 115, chroma: 0.7 },
  file: { icon: FileCode, hue: 200, chroma: 0.6 },
  step: { icon: Footprints, hue: 185, chroma: 0.9 },
  decision: { icon: Diamond, hue: 60, chroma: 1 },
  event: { icon: Zap, hue: 355, chroma: 1 },
  test: { icon: FlaskConical, hue: 140, chroma: 0.7 },
  other: { icon: Circle, hue: 260, chroma: 0.25 },
};

/** Inline style that feeds a kind's hue/chroma to the .kind-* classes. */
export function kindStyle(kind: NodeKind): CSSProperties {
  const v = NODE_VISUALS[kind];
  return { '--kind-h': v.hue, '--kind-c': v.chroma } as CSSProperties;
}

export interface EdgeVisual {
  /** SVG stroke-dasharray, undefined = solid. */
  dash?: string;
  width: number;
  /** Animate the dash (async / event edges). */
  animated: boolean;
  marker: 'arrow' | 'none';
}

export const EDGE_VISUALS: Record<EdgeKind, EdgeVisual> = {
  call: { width: 1.6, animated: false, marker: 'arrow' },
  data: { width: 1.6, animated: false, marker: 'arrow' },
  event: { dash: '6 4', width: 1.6, animated: true, marker: 'arrow' },
  dependency: { dash: '3 4', width: 1.3, animated: false, marker: 'arrow' },
  contains: { width: 1.3, animated: false, marker: 'none' },
  flow: { width: 1.8, animated: false, marker: 'arrow' },
  read: { width: 1.6, animated: false, marker: 'arrow' },
  write: { width: 2.2, animated: false, marker: 'arrow' },
  inherit: { dash: '8 3', width: 1.4, animated: false, marker: 'arrow' },
  other: { width: 1.4, animated: false, marker: 'arrow' },
};

export const GRAPH_KIND_ICONS: Record<GraphKind, LucideIcon> = {
  architecture: Network,
  flow: Workflow,
  sequence: ArrowRightLeft,
  dataflow: Waypoints,
  structure: Boxes,
  dependency: GitFork,
  state: CircleDot,
};

export const ORIGIN_VISUALS: Record<GraphOriginType, { icon: LucideIcon; label: string }> = {
  question: { icon: MessageSquare, label: 'Question' },
  expand: { icon: Maximize2, label: 'Expansion' },
  'ask-node': { icon: Crosshair, label: 'Question about a box' },
  'ask-graph': { icon: MessagesSquare, label: 'Follow-up' },
  'ask-code': { icon: CodeXml, label: 'Question about code' },
};

export const STATUS_VISUALS: Record<
  GraphStatus,
  { icon: LucideIcon; label: string; className: string; spin?: boolean }
> = {
  queued: { icon: Clock, label: 'Queued', className: 'text-subtle' },
  running: { icon: LoaderCircle, label: 'Generating', className: 'text-accent', spin: true },
  done: { icon: CircleCheck, label: 'Done', className: 'text-ok' },
  error: { icon: CircleX, label: 'Failed', className: 'text-danger' },
  cancelled: { icon: CircleStop, label: 'Cancelled', className: 'text-subtle' },
};
