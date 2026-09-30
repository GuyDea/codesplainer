import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Command } from 'cmdk';
import {
  FileDown,
  FileText,
  FolderOpen,
  FolderPlus,
  House,
  Import,
  Keyboard,
  Map as MapIcon,
  Maximize,
  Maximize2,
  MessageSquarePlus,
  PanelLeft,
  RefreshCw,
  Search,
  Settings,
  StepForward,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { expansionOfNode, getGraph, graphDisplayTitle, type Workspace } from '@codesplainer/shared';
import { diagramSteps } from '../graph/steps';
import { NODE_VISUALS, ORIGIN_VISUALS, kindStyle } from '../graph/visuals';
import { cn } from '../lib/cn';
import { relativeTime } from '../lib/format';
import { shortcutLabel } from '../lib/platform';
import { navigate, routes, type Route } from '../lib/router';
import {
  expandNode,
  exportConversation,
  fitView,
  focusAsk,
  graphCanvasRef,
  openDialog,
  openGraph,
  openSettings,
  redetectProviders,
  selectNode,
  setPaletteOpen,
  setView,
  sortWorkspacesRecent,
  toggleSidebar,
  toggleSteps,
  toggleTheme,
  toggleView,
  useAppStore,
} from '../store';
import { Kbd, StatusIcon } from '../ui';

export function CommandPalette({ route }: { route: Route }) {
  const open = useAppStore((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette route={route} />;
}

/** Word-prefix/substring filter over keywords only (values are ids). */
function paletteFilter(_value: string, search: string, keywords?: string[]): number {
  const terms = search.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return 1;
  const haystack = (keywords ?? []).join(' ').toLowerCase();
  let score = 1;
  for (const term of terms) {
    const index = haystack.indexOf(term);
    if (index < 0) return 0;
    const wordStart = index === 0 || /[\s“"(/:._-]/.test(haystack[index - 1] ?? ' ');
    score -= (wordStart ? 0 : 0.2) + Math.min(0.3, index / 600);
  }
  return Math.max(0.05, score);
}

function Palette({ route }: { route: Route }) {
  const conversation = useAppStore((s) => s.conversation);
  const currentGraphId = useAppStore((s) => s.currentGraphId);
  const selectedNodeId = useAppStore((s) => s.selection.nodeId);
  const conversations = useAppStore((s) => s.conversations);
  const conversationsWorkspaceId = useAppStore((s) => s.conversationsWorkspaceId);
  const workspaces = useAppStore((s) => s.workspaces);
  const view = useAppStore((s) => s.view);
  const [search, setSearch] = useState('');
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      // Restore focus unless an action moved it somewhere on purpose.
      if (!document.activeElement || document.activeElement === document.body) opener?.focus?.();
    };
  }, []);

  const inConversation =
    route.name === 'conversation' && conversation?.id === route.conversationId
      ? conversation
      : null;
  const workspaceId =
    route.name === 'workspace' || route.name === 'conversation' ? route.workspaceId : null;
  const graph =
    inConversation && currentGraphId ? getGraph(inConversation, currentGraphId) : undefined;
  const spec = graph?.status === 'done' ? graph.spec : undefined;
  const selectedNode =
    spec && selectedNodeId ? spec.nodes.find((n) => n.id === selectedNodeId) : undefined;
  const existingExpansion =
    inConversation && graph && selectedNode
      ? expansionOfNode(inConversation, graph.id, selectedNode.id)
      : undefined;
  const sortedWorkspaces = useMemo(() => sortWorkspacesRecent(workspaces), [workspaces]);
  const workspaceConversations =
    workspaceId && conversationsWorkspaceId === workspaceId ? conversations : [];

  const close = () => setPaletteOpen(false);
  const run = (action: () => void) => {
    close();
    action();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[850] flex items-start justify-center bg-black/40 p-4 pt-[12vh] backdrop-blur-[2px] animate-fade-in"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-palette
        className="w-full max-w-xl overflow-hidden rounded-xl border border-border bg-surface shadow-pop animate-pop-in"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <Command label="Command palette" loop filter={paletteFilter} className="flex flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search size={15} className="shrink-0 text-subtle" aria-hidden />
            <Command.Input
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="Search diagrams, boxes, conversations, actions…"
              className="h-11 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-subtle"
            />
            <Kbd>Esc</Kbd>
          </div>
          <Command.List className="max-h-[min(60vh,480px)] overflow-y-auto overscroll-contain p-1.5">
            <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">
              No matches
            </Command.Empty>

            {inConversation && inConversation.graphs.length ? (
              <Command.Group heading="Diagrams">
                {inConversation.graphs
                  .slice()
                  .reverse()
                  .map((g) => {
                    const OriginIcon = ORIGIN_VISUALS[g.origin.type].icon;
                    const title = graphDisplayTitle(g);
                    return (
                      <PaletteItem
                        key={g.id}
                        value={`diagram:${g.id}`}
                        keywords={['diagram', title, g.question]}
                        onSelect={() => run(() => openGraph(g.id))}
                        icon={<OriginIcon size={14} className="text-muted" />}
                        label={title}
                        detail={g.question !== title ? g.question : undefined}
                        trailing={
                          g.status !== 'done' ? (
                            <StatusIcon status={g.status} size={13} />
                          ) : g.id === currentGraphId ? (
                            <span className="text-[11px] text-subtle">current</span>
                          ) : null
                        }
                      />
                    );
                  })}
              </Command.Group>
            ) : null}

            {spec ? (
              <Command.Group heading="Boxes in this diagram">
                {spec.nodes.map((n) => {
                  const Icon = NODE_VISUALS[n.kind].icon;
                  return (
                    <PaletteItem
                      key={n.id}
                      value={`box:${n.id}`}
                      keywords={['box', n.label, n.detail ?? '', n.kind]}
                      onSelect={() =>
                        run(() => {
                          if (view === 'map') setView('diagram');
                          selectNode(n.id);
                          window.setTimeout(
                            () => graphCanvasRef.current?.focusNode(n.id),
                            view === 'map' ? 120 : 0,
                          );
                        })
                      }
                      icon={
                        <span style={kindStyle(n.kind)} className="kind-fg inline-flex">
                          <Icon size={14} />
                        </span>
                      }
                      label={n.label}
                      detail={n.detail}
                    />
                  );
                })}
              </Command.Group>
            ) : null}

            {workspaceConversations.length ? (
              <Command.Group heading="Conversations">
                {workspaceConversations.map((c) => (
                  <PaletteItem
                    key={c.id}
                    value={`conversation:${c.id}`}
                    keywords={['conversation', 'chat', c.title, c.lastQuestion ?? '']}
                    onSelect={() => run(() => navigate(routes.conversation(c.workspaceId, c.id)))}
                    icon={<MessageSquarePlus size={14} className="text-muted" />}
                    label={c.title}
                    detail={c.lastQuestion}
                    trailing={
                      <span className="text-[11px] text-subtle">{relativeTime(c.updatedAt)}</span>
                    }
                  />
                ))}
              </Command.Group>
            ) : null}

            {sortedWorkspaces.length ? (
              <Command.Group heading="Workspaces">
                {sortedWorkspaces.map((w) => (
                  <WorkspaceItem
                    key={w.id}
                    workspace={w}
                    current={w.id === workspaceId}
                    run={run}
                  />
                ))}
              </Command.Group>
            ) : null}

            <Command.Group heading="Actions">
              {workspaceId ? (
                <ActionItem
                  id="new-question"
                  icon={MessageSquarePlus}
                  label="New question"
                  shortcut="/"
                  keywords={['ask', 'question']}
                  onSelect={() => run(() => focusAsk(inConversation ? { type: 'new' } : undefined))}
                />
              ) : null}
              {selectedNode && existingExpansion ? (
                <ActionItem
                  id="expand-again"
                  icon={Maximize2}
                  label={`Expand “${selectedNode.label}” again`}
                  keywords={['expand', 'again', 'regenerate']}
                  onSelect={() => run(() => void expandNode(selectedNode.id, { again: true }))}
                />
              ) : null}
              {inConversation ? (
                <>
                  <ActionItem
                    id="toggle-map"
                    icon={MapIcon}
                    label={view === 'map' ? 'Show diagram' : 'Show conversation map'}
                    shortcut="M"
                    keywords={['map', 'toggle', 'view', 'diagram']}
                    onSelect={() => run(toggleView)}
                  />
                  <ActionItem
                    id="toggle-sidebar"
                    icon={PanelLeft}
                    label="Toggle sidebar"
                    shortcut={shortcutLabel('mod+b')}
                    keywords={['sidebar', 'outline', 'files']}
                    onSelect={() => run(toggleSidebar)}
                  />
                  <ActionItem
                    id="fit"
                    icon={Maximize}
                    label="Fit view"
                    shortcut="F"
                    keywords={['fit', 'zoom']}
                    onSelect={() => run(fitView)}
                  />
                  {spec && diagramSteps(spec).length ? (
                    <ActionItem
                      id="steps"
                      icon={StepForward}
                      label="Step through this diagram"
                      shortcut="P"
                      keywords={['step', 'through', 'play', 'walk', 'flow', 'sequence', 'order']}
                      onSelect={() =>
                        run(() => {
                          // The canvas only exists in the diagram view.
                          if (view === 'map') setView('diagram');
                          window.setTimeout(toggleSteps, view === 'map' ? 120 : 0);
                        })
                      }
                    />
                  ) : null}
                  <ActionItem
                    id="export-json"
                    icon={FileDown}
                    label="Export conversation (JSON)"
                    keywords={['export', 'download', 'json', 'share']}
                    onSelect={() => run(() => void exportConversation(inConversation, 'json'))}
                  />
                  <ActionItem
                    id="export-md"
                    icon={FileText}
                    label="Export conversation (Markdown)"
                    keywords={['export', 'download', 'markdown', 'md', 'docs']}
                    onSelect={() => run(() => void exportConversation(inConversation, 'md'))}
                  />
                </>
              ) : null}
              <ActionItem
                id="toggle-theme"
                icon={SunMoon}
                label="Toggle theme"
                keywords={['theme', 'dark', 'light', 'appearance']}
                onSelect={() => run(toggleTheme)}
              />
              <ActionItem
                id="settings"
                icon={Settings}
                label="Settings"
                keywords={['settings', 'preferences', 'providers']}
                onSelect={() => run(() => openSettings('general'))}
              />
              <ActionItem
                id="import"
                icon={Import}
                label="Import…"
                keywords={['import', 'open', 'upload', 'json']}
                onSelect={() => run(() => openDialog({ type: 'import' }))}
              />
              <ActionItem
                id="new-workspace"
                icon={FolderPlus}
                label="New workspace…"
                keywords={['workspace', 'folder', 'add', 'new']}
                onSelect={() => run(() => openDialog({ type: 'workspace-create' }))}
              />
              <ActionItem
                id="shortcuts"
                icon={Keyboard}
                label="Keyboard shortcuts"
                shortcut="?"
                keywords={['keyboard', 'shortcuts', 'help', 'keys']}
                onSelect={() => run(() => openDialog({ type: 'shortcuts' }))}
              />
              <ActionItem
                id="redetect"
                icon={RefreshCw}
                label="Re-detect providers"
                keywords={['providers', 'detect', 'refresh', 'agents', 'cli']}
                onSelect={() => run(() => void redetectProviders())}
              />
              {route.name !== 'home' ? (
                <ActionItem
                  id="home"
                  icon={House}
                  label="Go home"
                  keywords={['home', 'workspaces']}
                  onSelect={() => run(() => navigate(routes.home()))}
                />
              ) : null}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>,
    document.body,
  );
}

function WorkspaceItem({
  workspace,
  current,
  run,
}: {
  workspace: Workspace;
  current: boolean;
  run: (action: () => void) => void;
}) {
  return (
    <PaletteItem
      value={`workspace:${workspace.id}`}
      keywords={['workspace', workspace.name, ...workspace.folders.map((f) => f.path)]}
      onSelect={() => run(() => navigate(routes.workspace(workspace.id)))}
      icon={<FolderOpen size={14} className="text-muted" />}
      label={workspace.name}
      detail={workspace.folders.map((f) => f.alias).join(' · ')}
      trailing={current ? <span className="text-[11px] text-subtle">current</span> : null}
    />
  );
}

function ActionItem({
  id,
  icon: Icon,
  label,
  shortcut,
  keywords,
  onSelect,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  keywords: string[];
  onSelect: () => void;
}) {
  return (
    <PaletteItem
      value={`action:${id}`}
      keywords={['action', label, ...keywords]}
      onSelect={onSelect}
      icon={<Icon size={14} className="text-muted" />}
      label={label}
      trailing={shortcut ? <Kbd>{shortcut}</Kbd> : null}
    />
  );
}

function PaletteItem({
  value,
  keywords,
  onSelect,
  icon,
  label,
  detail,
  trailing,
}: {
  value: string;
  keywords: string[];
  onSelect: () => void;
  icon: ReactNode;
  label: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      keywords={keywords.filter(Boolean)}
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-fg select-none',
        'data-[selected=true]:bg-surface-2',
      )}
    >
      <span className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">
        {label}
        {detail ? <span className="ml-2 text-xs text-subtle">{detail}</span> : null}
      </span>
      {trailing ? <span className="flex shrink-0 items-center">{trailing}</span> : null}
    </Command.Item>
  );
}
