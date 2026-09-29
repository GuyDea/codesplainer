import { useMemo } from 'react';
import { ChevronsUpDown, FolderPlus, FolderTree, LayoutGrid } from 'lucide-react';
import { navigate, routes, type Route } from '../lib/router';
import { openDialog, sortWorkspacesRecent, useAppStore } from '../store';
import { Menu, type MenuItem } from '../ui';

const MAX_RECENT = 8;

export function WorkspaceSwitcher({ route }: { route: Route }) {
  const workspaces = useAppStore((s) => s.workspaces);
  const currentId =
    route.name === 'workspace' || route.name === 'conversation' ? route.workspaceId : null;
  const current = workspaces.find((w) => w.id === currentId);
  const recent = useMemo(() => sortWorkspacesRecent(workspaces).slice(0, MAX_RECENT), [workspaces]);

  const items: MenuItem[] = [
    ...(recent.length ? [{ type: 'label' as const, id: 'recent', label: 'Workspaces' }] : []),
    ...recent.map<MenuItem>((w) => ({
      id: w.id,
      label: w.name,
      checked: w.id === currentId,
      hint: w.folders.length > 1 ? `${w.folders.length} folders` : undefined,
      onSelect: () => navigate(routes.workspace(w.id)),
    })),
    ...(recent.length ? [{ type: 'separator' as const, id: 'sep' }] : []),
    {
      id: 'new',
      label: 'New workspace…',
      icon: FolderPlus,
      onSelect: () => openDialog({ type: 'workspace-create' }),
    },
    ...(current
      ? [
          {
            id: 'edit',
            label: 'Edit folders…',
            icon: FolderTree,
            onSelect: () => openDialog({ type: 'workspace-edit', workspaceId: current.id }),
          },
        ]
      : []),
    {
      id: 'all',
      label: 'All workspaces',
      icon: LayoutGrid,
      onSelect: () => navigate(routes.home()),
    },
  ];

  const label = current?.name ?? (currentId ? 'Workspace' : 'Workspaces');
  return (
    <Menu items={items} minWidth={240}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={`Workspace: ${label}`}
        className="inline-flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[13px] font-medium text-fg transition-colors hover:bg-surface-2"
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown size={13} className="shrink-0 text-subtle" />
      </button>
    </Menu>
  );
}
