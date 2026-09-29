/** Compact zoom / fit controls shown in a canvas corner. */
import type { ReactNode } from 'react';
import { Panel, useReactFlow, useStore, type PanelPosition } from '@xyflow/react';
import { Minus, Plus, Scan } from 'lucide-react';
import { IconButton, Tooltip } from '../../ui';
import { motion } from './motion';

const zoomSelector = (s: { transform: [number, number, number] }) => s.transform[2];

export function CanvasControls({
  onFit,
  position = 'bottom-right',
  children,
}: {
  onFit: () => void;
  position?: PanelPosition;
  children?: ReactNode;
}) {
  const rf = useReactFlow();
  const zoom = useStore(zoomSelector);
  return (
    <Panel position={position} className="cs-no-export">
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 shadow-card">
        {children}
        <IconButton
          icon={Minus}
          label="Zoom out"
          size="xs"
          tooltipSide="top"
          onClick={() => void rf.zoomOut({ duration: motion(160) })}
        />
        <Tooltip label="Reset to 100%" side="top">
          <button
            type="button"
            className="h-6 min-w-[42px] rounded-md px-1 text-center text-[11px] font-medium text-muted tabular-nums transition-colors hover:bg-surface-2 hover:text-fg"
            onClick={() => void rf.zoomTo(1, { duration: motion(200) })}
            aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
          >
            {Math.round(zoom * 100)}%
          </button>
        </Tooltip>
        <IconButton
          icon={Plus}
          label="Zoom in"
          size="xs"
          tooltipSide="top"
          onClick={() => void rf.zoomIn({ duration: motion(160) })}
        />
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <IconButton
          icon={Scan}
          label="Fit to view"
          shortcut="F"
          size="xs"
          tooltipSide="top"
          onClick={onFit}
        />
      </div>
    </Panel>
  );
}
