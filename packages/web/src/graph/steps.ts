/**
 * Step player model (pure): which arrows make up each step of a diagram, the code a step points
 * at and its one-line caption. Used by GraphCanvas and the command palette.
 */
import {
  orderedMessages,
  type CodeRef,
  type GraphEdge,
  type GraphSpec,
} from '@codesplainer/shared';

/** One stop of the step player: the arrows sharing a step number, or one sequence message. */
export interface DiagramStep {
  /** The number shown on the arrows (unnumbered sequence messages have none). */
  number?: number;
  /** Arrow ids, in diagram order. */
  edgeIds: string[];
}

/**
 * The stops of the step player, in order. Sequence diagrams: every message, in the order the
 * sequence view draws them. Other diagrams: the arrows that carry a step number, grouped by
 * number (branches of a decision may share one). Fewer than two stops: none.
 */
export function diagramSteps(spec: GraphSpec): DiagramStep[] {
  const steps: DiagramStep[] = [];
  for (const edge of orderedMessages(spec)) {
    if (edge.step === undefined && spec.kind !== 'sequence') continue;
    const last = steps[steps.length - 1];
    if (last && edge.step !== undefined && last.number === edge.step) {
      last.edgeIds.push(edge.id);
    } else {
      steps.push(
        edge.step !== undefined
          ? { number: edge.step, edgeIds: [edge.id] }
          : { edgeIds: [edge.id] },
      );
    }
  }
  return steps.length >= 2 ? steps : [];
}

function stepEdges(spec: GraphSpec, step: DiagramStep): GraphEdge[] {
  return step.edgeIds
    .map((id) => spec.edges.find((e) => e.id === id))
    .filter((e): e is GraphEdge => e !== undefined);
}

const isFile = (ref: CodeRef) => Boolean(ref.path) && !ref.isDir;

/**
 * The code to show for a step, and the box it belongs to: the arrow's own ref (the call site,
 * in the source box), else the line range of the box the arrow leads to (what runs next).
 * Directories and boxes without a line range are too coarse to follow.
 */
export function stepCode(
  spec: GraphSpec,
  step: DiagramStep,
): { ref: CodeRef; nodeId: string } | undefined {
  const edges = stepEdges(spec, step);
  for (const edge of edges) {
    const ref = edge.refs?.find(isFile);
    if (ref) return { ref, nodeId: edge.from };
  }
  for (const edge of edges) {
    const target = spec.nodes.find((n) => n.id === edge.to);
    const ref = target?.refs.find((r) => isFile(r) && r.startLine !== undefined);
    if (ref) return { ref, nodeId: edge.to };
  }
  return undefined;
}

/** "From → To: label", plus "+N" when several arrows share the step. */
export function stepCaption(spec: GraphSpec, step: DiagramStep): string {
  const edges = stepEdges(spec, step);
  const first = edges[0];
  if (!first) return '';
  const label = (id: string) => spec.nodes.find((n) => n.id === id)?.label ?? id;
  const more = edges.length > 1 ? ` (+${edges.length - 1})` : '';
  return `${label(first.from)} → ${label(first.to)}${first.label ? `: ${first.label}` : ''}${more}`;
}
