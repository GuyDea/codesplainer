import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Ellipsis,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Import,
  Plus,
  Trash,
} from 'lucide-react';
import type { Workspace } from '@codesplainer/shared';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { plural, relativeTime } from '../../lib/format';
import { navigate, routes } from '../../lib/router';
import { useNow } from '../../lib/useNow';
import {
  deleteWorkspaceFlow,
  exportWorkspaceBundle,
  openDialog,
  sortWorkspacesRecent,
} from '../../store';
import { Button, IconButton, Menu } from '../../ui';
import { FolderChips } from '../common/FolderChips';

const MAX_COUNTED = 24;

/** Conversation counts per workspace (one small request each, only for the first few). */
function useConversationCounts(ids: string[]): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const key = ids.slice(0, MAX_COUNTED).join(',');
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void Promise.all(
      key.split(',').map(async (id) => {
        try {
          const { conversations } = await api.listConversations(id);
          return [id, conversations.length] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      setCounts(
        Object.fromEntries(entries.filter((e): e is readonly [string, number] => e !== null)),
      );
    });
    return () => {
      alive = false;
    };
  }, [key]);
  return counts;
}

export function WorkspaceGallery({ workspaces }: { workspaces: Workspace[] }) {
  const sorted = useMemo(() => sortWorkspacesRecent(workspaces), [workspaces]);
  const counts = useConversationCounts(sorted.map((w) => w.id));
  const now = useNow();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10 animate-fade-in">
        <header className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-fg">Workspaces</h1>
          <div className="flex items-center gap-2">
            <Button variant="ghost" icon={Import} onClick={() => openDialog({ type: 'import' })}>
              Import
            </Button>
            <Button
              variant="primary"
              icon={FolderPlus}
              onClick={() => openDialog({ type: 'workspace-create' })}
            >
              New workspace
            </Button>
          </div>
        </header>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((w) => (
            <WorkspaceCard key={w.id} workspace={w} count={counts[w.id]} now={now} />
          ))}
          <li>
            <button
              type="button"
              onClick={() => openDialog({ type: 'workspace-create' })}
              className="flex h-full min-h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-[13px] text-muted transition-colors hover:border-border-strong hover:bg-surface hover:text-fg"
            >
              <Plus size={18} aria-hidden />
              New workspace
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

function WorkspaceCard({
  workspace,
  count,
  now,
}: {
  workspace: Workspace;
  count?: number;
  now: number;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => navigate(routes.workspace(workspace.id))}
        className="flex h-full min-h-32 w-full flex-col gap-3 rounded-xl border border-border bg-surface p-4 text-left shadow-card transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-pop"
      >
        <span className="flex min-w-0 items-center gap-2.5 pr-8">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <FolderOpen size={16} aria-hidden />
          </span>
          <span className="truncate text-sm font-semibold text-fg">{workspace.name}</span>
        </span>
        <FolderChips folders={workspace.folders} />
        <span className="mt-auto flex items-center gap-1.5 text-xs text-subtle">
          <span>{relativeTime(workspace.lastOpenedAt ?? workspace.updatedAt, now)}</span>
          {count !== undefined ? (
            <>
              <span aria-hidden>·</span>
              <span>{plural(count, 'conversation')}</span>
            </>
          ) : null}
        </span>
      </button>
      <div
        className={cn(
          'absolute top-3 right-3 transition-opacity',
          menuOpen
            ? 'opacity-100'
            : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        <Menu
          align="end"
          onOpenChange={setMenuOpen}
          items={[
            {
              id: 'open',
              label: 'Open',
              icon: FolderOpen,
              onSelect: () => navigate(routes.workspace(workspace.id)),
            },
            {
              id: 'edit',
              label: 'Edit folders…',
              icon: FolderTree,
              onSelect: () => openDialog({ type: 'workspace-edit', workspaceId: workspace.id }),
            },
            {
              id: 'export',
              label: 'Export bundle',
              icon: Download,
              onSelect: () => void exportWorkspaceBundle(workspace),
            },
            { type: 'separator', id: 'sep' },
            {
              id: 'delete',
              label: 'Delete…',
              icon: Trash,
              danger: true,
              onSelect: () => void deleteWorkspaceFlow(workspace),
            },
          ]}
        >
          <IconButton icon={Ellipsis} label="Workspace actions" size="xs" variant="ghost" />
        </Menu>
      </div>
    </li>
  );
}
