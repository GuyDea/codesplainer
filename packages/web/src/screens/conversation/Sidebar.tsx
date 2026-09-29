import { useCallback, useRef } from 'react';
import { Files, ListTree, MessagesSquare, PanelLeftClose, Plus, Search, X } from 'lucide-react';
import type { Conversation, ConversationSummary, Workspace } from '@codesplainer/shared';
import { FileExplorer } from '../../panels/FileExplorer';
import { Outline } from '../../panels/Outline';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import { plural, relativeTime } from '../../lib/format';
import { shortcutLabel } from '../../lib/platform';
import { navigate, routes } from '../../lib/router';
import { useNow } from '../../lib/useNow';
import {
  askAboutCode,
  cancelDiagram,
  deleteDiagram,
  focusAsk,
  openCode,
  openGraph,
  renameDiagram,
  retryDiagram,
  setDiagramStar,
  setOutlineFilter,
  setSidebarOpen,
  setSidebarTab,
  useAppStore,
  type SidebarTab,
} from '../../store';
import { IconButton, Spinner, Tabs } from '../../ui';
import { RunningBadge } from '../workspace/ConversationList';

const EMPTY: ConversationSummary[] = [];

interface Props {
  conversation: Conversation;
  workspace: Workspace | undefined;
  currentGraphId: string | null;
}

export function Sidebar({ conversation, workspace, currentGraphId }: Props) {
  const tab = useAppStore((s) => s.sidebar.tab);
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex items-center pr-1">
        <Tabs<SidebarTab>
          aria-label="Sidebar"
          value={tab}
          onChange={setSidebarTab}
          idPrefix="sidebar"
          className="min-w-0 flex-1 px-1.5"
          items={[
            { value: 'outline', label: 'Outline', icon: ListTree },
            { value: 'files', label: 'Files', icon: Files },
            { value: 'chats', label: 'Chats', icon: MessagesSquare },
          ]}
        />
        <IconButton
          icon={PanelLeftClose}
          label="Hide sidebar"
          shortcut={shortcutLabel('mod+b')}
          size="xs"
          onClick={() => setSidebarOpen(false)}
        />
      </div>
      <div
        role="tabpanel"
        id={`sidebar-panel-${tab}`}
        aria-labelledby={`sidebar-tab-${tab}`}
        className="flex min-h-0 flex-1 flex-col border-t border-border"
      >
        {tab === 'outline' ? (
          <OutlineTab conversation={conversation} currentGraphId={currentGraphId} />
        ) : tab === 'files' ? (
          workspace ? (
            <FilesTab workspace={workspace} />
          ) : (
            <div className="flex flex-1 items-center justify-center">
              <Spinner />
            </div>
          )
        ) : (
          <ChatsTab workspaceId={conversation.workspaceId} currentId={conversation.id} />
        )}
      </div>
    </div>
  );
}

function OutlineTab({
  conversation,
  currentGraphId,
}: {
  conversation: Conversation;
  currentGraphId: string | null;
}) {
  const filter = useAppStore((s) => s.outlineFilter);
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <div className="relative px-2 pt-2 pb-1">
        <Search
          size={13}
          className="pointer-events-none absolute top-1/2 left-4 mt-0.5 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          ref={input}
          type="search"
          aria-label="Filter diagrams"
          value={filter}
          onChange={(e) => setOutlineFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && filter) {
              e.preventDefault();
              e.stopPropagation();
              setOutlineFilter('');
            }
          }}
          placeholder="Filter"
          className="h-7 w-full rounded-md border border-transparent bg-surface-2 pr-7 pl-7 text-[13px] text-fg placeholder:text-subtle focus:border-accent focus:bg-surface focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {filter ? (
          <button
            type="button"
            aria-label="Clear filter"
            onClick={() => {
              setOutlineFilter('');
              input.current?.focus();
            }}
            className="absolute top-1/2 right-3.5 mt-0.5 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-subtle hover:text-fg"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      <Outline
        conversation={conversation}
        currentGraphId={currentGraphId}
        onOpen={openGraph}
        onRetry={(id) => void retryDiagram(id)}
        onCancel={(id) => void cancelDiagram(id)}
        onDelete={(id) => void deleteDiagram(id)}
        onToggleStar={(id, starred) => void setDiagramStar(id, starred)}
        onRename={(id, title) => void renameDiagram(id, title)}
        filter={filter}
        className="min-h-0 flex-1 overflow-y-auto"
      />
    </>
  );
}

function FilesTab({ workspace }: { workspace: Workspace }) {
  const explorerRef = useAppStore((s) => s.explorerRef);
  // The highlighted file may belong to a previously opened workspace: only reveal own folders.
  const activeRef =
    explorerRef && workspace.folders.some((f) => f.alias === explorerRef.folder)
      ? explorerRef
      : null;
  const loadDir = useCallback(
    (folder: string, path: string) => api.listDir(workspace.id, folder, path),
    [workspace.id],
  );
  return (
    <FileExplorer
      workspace={workspace}
      loadDir={loadDir}
      onOpenFile={(ref) => void openCode(ref, { back: null, context: null })}
      onAskAbout={(ref) => askAboutCode(ref, null)}
      activeRef={activeRef}
      className="min-h-0 flex-1 overflow-y-auto"
    />
  );
}

function ChatsTab({ workspaceId, currentId }: { workspaceId: string; currentId: string }) {
  const conversations = useAppStore((s) =>
    s.conversationsWorkspaceId === workspaceId ? s.conversations : EMPTY,
  );
  const status = useAppStore((s) => s.conversationsStatus);
  const now = useNow();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="p-2">
        <button
          type="button"
          onClick={() => {
            navigate(routes.workspace(workspaceId));
            focusAsk();
          }}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-dashed border-border px-2 text-[13px] text-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          <Plus size={14} aria-hidden />
          New conversation
        </button>
      </div>
      {status === 'loading' && !conversations.length ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto px-1 pb-2" aria-label="Conversations">
          {conversations.map((c) => {
            const current = c.id === currentId;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-current={current ? 'page' : undefined}
                  onClick={() => navigate(routes.conversation(c.workspaceId, c.id))}
                  className={cn(
                    'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                    current ? 'bg-accent-soft' : 'hover:bg-surface-2',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'truncate text-[13px] font-medium',
                        current ? 'text-accent' : 'text-fg',
                      )}
                    >
                      {c.title}
                    </span>
                    <RunningBadge count={c.runningCount} />
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-subtle">
                    <span>{relativeTime(c.updatedAt, now)}</span>
                    <span aria-hidden>·</span>
                    <span>{plural(c.graphCount, 'diagram')}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
