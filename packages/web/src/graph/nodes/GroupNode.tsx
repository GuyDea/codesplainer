/** Group container (compound node) and sequence lifeline. Both are non-interactive. */
import { memo, type CSSProperties } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { GroupFlowNode, LifelineFlowNode } from '../canvas/types';

function GroupNodeComponent({ data }: NodeProps<GroupFlowNode>) {
  return (
    <div
      key={data.layoutKey}
      className="cs-group cs-enter relative"
      style={{ '--cs-delay': `${data.delay}ms` } as CSSProperties}
    >
      <div className="absolute top-2.5 left-2.5 flex h-[22px] max-w-[calc(100%-20px)] items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-[11.5px] font-semibold text-muted shadow-card">
        <span className="size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
        <span className="truncate">{data.label}</span>
      </div>
    </div>
  );
}

function LifelineNodeComponent({ data }: NodeProps<LifelineFlowNode>) {
  return (
    <div
      key={data.layoutKey}
      className="cs-lifeline cs-enter"
      style={{ '--cs-delay': `${data.delay}ms` } as CSSProperties}
    />
  );
}

export const GroupNode = memo(GroupNodeComponent);
export const LifelineNode = memo(LifelineNodeComponent);
