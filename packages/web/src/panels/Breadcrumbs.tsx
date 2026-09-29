import { ChevronRight, Ellipsis } from 'lucide-react';
import { graphDisplayTitle, truncate, type GraphEntry } from '@codesplainer/shared';
import { cn } from '../lib/cn';
import { ORIGIN_VISUALS } from '../graph/visuals';
import { IconButton, Menu, Tooltip, type MenuItem } from '../ui';
import type { BreadcrumbsProps } from './types';

type Crumb = { kind: 'entry'; entry: GraphEntry } | { kind: 'more'; hidden: GraphEntry[] };

/** Root → … → current. Long paths fold their middle into a "…" menu. */
export function Breadcrumbs({ path, onOpen, maxItems = 4, className }: BreadcrumbsProps) {
  if (!path.length) return null;
  const max = Math.max(3, maxItems);
  const crumbs: Crumb[] =
    path.length > max
      ? [
          { kind: 'entry', entry: path[0] as GraphEntry },
          { kind: 'more', hidden: path.slice(1, path.length - (max - 2)) },
          ...path
            .slice(path.length - (max - 2))
            .map((entry) => ({ kind: 'entry' as const, entry })),
        ]
      : path.map((entry) => ({ kind: 'entry' as const, entry }));
  const currentId = path[path.length - 1]?.id;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-0.5 text-[13px]">
        {crumbs.map((crumb, index) => {
          const separator =
            index > 0 ? (
              <ChevronRight size={13} aria-hidden className="shrink-0 text-subtle" />
            ) : null;
          if (crumb.kind === 'more') {
            const items: MenuItem[] = crumb.hidden.map((entry) => ({
              id: entry.id,
              label: truncate(graphDisplayTitle(entry), 60),
              icon: ORIGIN_VISUALS[entry.origin.type].icon,
              onSelect: () => onOpen(entry.id),
            }));
            return (
              <li key="more" className="flex shrink-0 items-center gap-0.5">
                {separator}
                <Menu items={items} minWidth={220}>
                  <IconButton icon={Ellipsis} size="xs" label={`${crumb.hidden.length} more`} />
                </Menu>
              </li>
            );
          }
          const { entry } = crumb;
          const current = entry.id === currentId;
          const title = graphDisplayTitle(entry);
          const Icon = ORIGIN_VISUALS[entry.origin.type].icon;
          const content = (
            <>
              <Icon size={13} aria-hidden className="shrink-0 opacity-75" />
              <span className="min-w-0 truncate">{truncate(title, 60)}</span>
            </>
          );
          return (
            <li
              key={entry.id}
              className={cn(
                'flex min-w-0 items-center gap-0.5',
                current ? 'shrink-[0.4]' : 'shrink',
              )}
            >
              {separator}
              {current ? (
                <Tooltip label={title} disabled={title.length <= 40} className="min-w-0">
                  <span
                    aria-current="page"
                    className="flex h-6 min-w-0 items-center gap-1.5 px-1.5 font-semibold text-fg"
                  >
                    {content}
                  </span>
                </Tooltip>
              ) : (
                <Tooltip label={title} disabled={title.length <= 24} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => onOpen(entry.id)}
                    className={cn(
                      'flex h-6 max-w-[14rem] min-w-0 items-center gap-1.5 rounded-md px-1.5 text-muted transition-colors',
                      'hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
                    )}
                  >
                    {content}
                  </button>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
