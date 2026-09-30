import { Folder, SquareArrowOutUpRight } from 'lucide-react';
import { formatRef, type CodeRef } from '@codesplainer/shared';
import { IconButton, Tooltip } from '../ui';
import { dirName, fileIcon, fileName, lineRangeLabel } from './helpers';

/** Code locations of a box or an arrow: click opens the code viewer, the side button the editor. */
export function RefList({
  refs,
  multiFolder,
  onOpen,
  onOpenInEditor,
}: {
  refs: CodeRef[];
  multiFolder: boolean;
  onOpen: (ref: CodeRef) => void;
  onOpenInEditor?: (ref: CodeRef) => void;
}) {
  return (
    <ul className="flex flex-col">
      {refs.map((ref, index) => {
        const name = fileName(ref.path) || ref.folder || '.';
        const lines = lineRangeLabel(ref);
        const dir = dirName(ref.path);
        const where = [multiFolder && ref.folder ? ref.folder : '', dir].filter(Boolean).join(':');
        const secondary = [ref.symbol, where].filter(Boolean).join(' · ');
        const RefIcon = ref.isDir ? Folder : fileIcon(name);
        return (
          <li
            key={`${index}:${formatRef(ref)}`}
            className="group flex items-center rounded-md hover:bg-surface-2"
          >
            <Tooltip label={formatRef(ref, multiFolder)} delay={600} className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onOpen(ref)}
                className="flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
              >
                <RefIcon size={14} aria-hidden className="mt-px shrink-0 text-subtle" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-mono text-[12px] text-fg">
                    {name}
                    {lines ? <span className="text-subtle">:{lines}</span> : null}
                  </span>
                  {secondary ? (
                    <span className="truncate font-mono text-[11px] text-subtle">{secondary}</span>
                  ) : null}
                </span>
              </button>
            </Tooltip>
            {onOpenInEditor ? (
              <IconButton
                icon={SquareArrowOutUpRight}
                label="Open in editor"
                size="xs"
                onClick={() => onOpenInEditor(ref)}
                className="mr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
