/** Bar of the step player: previous / next, position, the step's caption, the code switch. */
import type { KeyboardEvent } from 'react';
import { Panel } from '@xyflow/react';
import { ChevronLeft, ChevronRight, CodeXml, X } from 'lucide-react';
import { IconButton } from '../../ui';

export interface StepPlayerProps {
  /** 0-based position. */
  index: number;
  count: number;
  caption: string;
  /** Some step has code: offer the "show each step's code" switch. */
  hasCode: boolean;
  followCode: boolean;
  onMove: (delta: number) => void;
  onJump: (index: number) => void;
  onToggleCode: () => void;
  onClose: () => void;
}

export function StepPlayer({
  index,
  count,
  caption,
  hasCode,
  followCode,
  onMove,
  onJump,
  onToggleCode,
  onClose,
}: StepPlayerProps) {
  // The canvas ignores keys pressed on buttons, so the bar handles them while it has focus.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let handled = true;
    if (event.key === 'ArrowLeft' || event.key === ',') onMove(-1);
    else if (event.key === 'ArrowRight' || event.key === '.') onMove(1);
    else if (event.key === 'Home') onJump(0);
    else if (event.key === 'End') onJump(count - 1);
    else if (event.key === 'Escape') onClose();
    else handled = false;
    if (handled) event.preventDefault();
  };

  return (
    <Panel position="bottom-left" className="cs-step-player cs-no-export">
      <div
        role="toolbar"
        aria-label="Step through the diagram"
        onKeyDown={onKeyDown}
        className="flex min-w-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-card animate-pop-in"
      >
        <IconButton
          icon={ChevronLeft}
          label="Previous step"
          shortcut=","
          size="xs"
          tooltipSide="top"
          disabled={index <= 0}
          onClick={() => onMove(-1)}
        />
        <span className="shrink-0 px-1 text-[11px] font-semibold text-muted tabular-nums">
          {index + 1} / {count}
        </span>
        <IconButton
          icon={ChevronRight}
          label="Next step"
          shortcut="."
          size="xs"
          tooltipSide="top"
          disabled={index >= count - 1}
          onClick={() => onMove(1)}
        />
        <span className="min-w-0 truncate px-1.5 text-[12.5px] text-fg" title={caption}>
          {caption}
        </span>
        {hasCode ? (
          <>
            <span className="mx-0.5 h-4 w-px shrink-0 bg-border" aria-hidden />
            <IconButton
              icon={CodeXml}
              label="Show each step's code"
              size="xs"
              tooltipSide="top"
              active={followCode}
              onClick={onToggleCode}
            />
          </>
        ) : null}
        <IconButton
          icon={X}
          label="Stop stepping"
          shortcut="Esc"
          size="xs"
          tooltipSide="top"
          onClick={onClose}
        />
      </div>
    </Panel>
  );
}
