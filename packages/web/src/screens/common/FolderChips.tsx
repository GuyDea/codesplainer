import { Folder } from 'lucide-react';
import type { WorkspaceFolder } from '@codesplainer/shared';
import { cn } from '../../lib/cn';

/** Compact list of workspace folders (alias, full path on hover). */
export function FolderChips({
  folders,
  max = 4,
  className,
}: {
  folders: WorkspaceFolder[];
  max?: number;
  className?: string;
}) {
  const shown = folders.slice(0, max);
  const rest = folders.length - shown.length;
  return (
    <ul className={cn('flex min-w-0 flex-wrap items-center gap-1', className)} aria-label="Folders">
      {shown.map((f) => (
        <li
          key={f.alias}
          title={f.path}
          className="inline-flex h-5 max-w-[24ch] items-center gap-1 rounded-full bg-surface-2 px-2 text-[11px] font-medium text-muted"
        >
          <Folder size={11} className="shrink-0 text-subtle" aria-hidden />
          <span className="truncate">{f.alias}</span>
        </li>
      ))}
      {rest > 0 ? (
        <li
          title={folders
            .slice(max)
            .map((f) => f.path)
            .join('\n')}
          className="inline-flex h-5 items-center rounded-full bg-surface-2 px-2 text-[11px] text-subtle"
        >
          +{rest}
        </li>
      ) : null}
    </ul>
  );
}
